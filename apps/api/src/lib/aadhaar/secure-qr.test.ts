import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign, createPublicKey, createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { verifySecureQr, mobileHashMatches, QrParseError } from "./secure-qr.js";
import type { LoadedCertificate } from "./cert-store.js";

const DELIM = Buffer.from([0xff]);

/** A throwaway RSA keypair standing in for UIDAI's signer. */
function keypair() {
  return generateKeyPairSync("rsa", { modulusLength: 2048 });
}

function asCertificate(publicKeyPem: string, file = "test.cer"): LoadedCertificate {
  return {
    file,
    subject: "CN=Test Signer",
    issuer: "CN=Test CA",
    validFrom: new Date("2020-01-01"),
    validTo: new Date("2099-01-01"),
    publicKey: createPublicKey(publicKeyPem),
    fingerprint256: "00:11",
  };
}

const FIELDS = [
  "2",                       // indicator: mobile hash present
  "705811092026143000000",   // last4 + DDMMYYYYHHMMSSmmm -> 11-09-2026 14:30:00
  "Balwinder Singh",
  "12-04-1978",
  "M",
  "S/O Gurdeep Singh",
  "Sangrur",
  "Near Grain Market",
  "142",
  "Longowal",
  "148106",
  "Longowal",
  "Punjab",
  "Main Bazaar",
  "Sunam",
  "Longowal",
];

interface BuildOpts {
  fields?: string[];
  mobileDigits?: string;
  signWith?: ReturnType<typeof keypair>["privateKey"];
  corruptBody?: boolean;
}

/** Builds a payload in the documented Secure QR layout. */
function buildPayload(opts: BuildOpts = {}): { payload: string; publicKeyPem: string } {
  const fields = opts.fields ?? FIELDS;
  const keys = keypair();
  const privateKey = opts.signWith ?? keys.privateKey;

  const text = Buffer.concat(fields.flatMap((f) => [Buffer.from(f, "utf8"), DELIM]));
  const photo = Buffer.alloc(48, 0x7a);
  const mobileHash = opts.mobileDigits
    ? createHash("sha256").update(opts.mobileDigits, "utf8").digest()
    : Buffer.alloc(32, 0x11);

  let body = Buffer.concat([text, photo, mobileHash]);

  const signer = createSign("RSA-SHA256");
  signer.update(body);
  signer.end();
  const signature = signer.sign(privateKey);

  // Flip a byte AFTER signing, to model a payload altered in transit.
  if (opts.corruptBody) {
    body = Buffer.from(body);
    body[text.length + 2] ^= 0xff;
  }

  const compressed = gzipSync(Buffer.concat([body, signature]));
  return {
    payload: BigInt("0x" + compressed.toString("hex")).toString(10),
    publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

describe("Secure QR — parsing", () => {
  test("reads every documented field", () => {
    const { payload, publicKeyPem } = buildPayload();
    const r = verifySecureQr(payload, [asCertificate(publicKeyPem)]);

    assert.equal(r.identity.name, "Balwinder Singh");
    assert.equal(r.identity.dateOfBirth, "12-04-1978");
    assert.equal(r.identity.gender, "M");
    assert.equal(r.identity.district, "Sangrur");
    assert.equal(r.identity.state, "Punjab");
    assert.equal(r.identity.pincode, "148106");
    assert.equal(r.identity.vtc, "Longowal");
  });

  test("extracts the last four digits from the reference ID", () => {
    const { payload, publicKeyPem } = buildPayload();
    const r = verifySecureQr(payload, [asCertificate(publicKeyPem)]);
    assert.equal(r.identity.aadhaarLast4, "7058");
  });

  test("parses the issue timestamp as DDMMYYYY, not YYYYMMDD", () => {
    // The order that caught out the first sample payload written for this.
    const { payload, publicKeyPem } = buildPayload();
    const r = verifySecureQr(payload, [asCertificate(publicKeyPem)]);
    assert.equal(r.identity.issuedAt?.toISOString(), "2026-09-11T14:30:00.000Z");
  });

  test("never exposes the Aadhaar number or the photo", () => {
    const { payload, publicKeyPem } = buildPayload();
    const r = verifySecureQr(payload, [asCertificate(publicKeyPem)]);
    // The QR carries no Aadhaar number at all, so there is nothing to leak —
    // which is also why the UIDAI Data Vault requirement never applies.
    assert.equal(Object.hasOwn(r.identity, "photo"), false);
    assert.equal(r.identity.aadhaarLast4.length, 4);
  });

  test("rejects things that are not a Secure QR", () => {
    assert.throws(() => verifySecureQr("not-digits-at-all", []), QrParseError);
    assert.throws(() => verifySecureQr("12345", []), QrParseError);
    // Digits, but not compressed data.
    assert.throws(() => verifySecureQr("9".repeat(200), []), QrParseError);
  });

  test("a truncated payload fails loudly rather than half-parsing", () => {
    const { payload } = buildPayload({ fields: FIELDS.slice(0, 6) });
    assert.throws(() => verifySecureQr(payload, []), QrParseError);
  });
});

describe("Secure QR — signature", () => {
  test("verifies a payload signed by the matching certificate", () => {
    // The positive path. Without a test seam this could only ever be proven
    // with a real Aadhaar card.
    const { payload, publicKeyPem } = buildPayload();
    const r = verifySecureQr(payload, [asCertificate(publicKeyPem, "uidai_test.cer")]);

    assert.equal(r.signatureVerified, true);
    assert.equal(r.certificateFile, "uidai_test.cer");
    assert.match(r.message, /verified/i);
  });

  test("rejects a payload signed by a different key", () => {
    const other = keypair();
    const { payload } = buildPayload({ signWith: other.privateKey });
    const { publicKeyPem } = buildPayload();

    const r = verifySecureQr(payload, [asCertificate(publicKeyPem)]);
    assert.equal(r.signatureVerified, false);
    assert.equal(r.certificateFile, null);
  });

  test("rejects a payload altered after signing", () => {
    const { payload, publicKeyPem } = buildPayload({ corruptBody: true });
    const r = verifySecureQr(payload, [asCertificate(publicKeyPem)]);
    assert.equal(r.signatureVerified, false);
  });

  test("with NO certificate installed it still parses, but never verifies", () => {
    // The rule that matters: a missing certificate must not silently upgrade an
    // unchecked scan. It fails closed, and says so.
    const { payload } = buildPayload();
    const r = verifySecureQr(payload, []);

    assert.equal(r.signatureVerified, false);
    assert.equal(r.identity.name, "Balwinder Singh", "identity is still readable");
    assert.match(r.message, /no UIDAI certificate is installed/i);
  });

  test("tries every installed certificate, not only the first", () => {
    // UIDAI rotates the signer, so a QR under the previous certificate must
    // keep verifying.
    const stale = buildPayload().publicKeyPem;
    const { payload, publicKeyPem } = buildPayload();

    const r = verifySecureQr(payload, [
      asCertificate(stale, "old.cer"),
      asCertificate(publicKeyPem, "current.cer"),
    ]);
    assert.equal(r.signatureVerified, true);
    assert.equal(r.certificateFile, "current.cer");
  });
});

describe("Secure QR — mobile binding", () => {
  test("detects the mobile hash when the indicator says it is present", () => {
    const { payload, publicKeyPem } = buildPayload();
    const r = verifySecureQr(payload, [asCertificate(publicKeyPem)]);
    assert.equal(typeof r.hashes.mobile, "string");
    assert.equal(r.hashes.mobile?.length, 64, "SHA-256 as hex");
  });

  test("reports absent when the indicator says neither hash is present", () => {
    const noHashes = ["0", ...FIELDS.slice(1)];
    const { payload, publicKeyPem } = buildPayload({ fields: noHashes });
    const r = verifySecureQr(payload, [asCertificate(publicKeyPem)]);
    assert.equal(r.hashes.mobile, null);
    assert.equal(r.hashes.email, null);
  });

  test("matching is advisory and returns null when it cannot be evaluated", () => {
    // The exact UIDAI construction is unconfirmed, so a mismatch is not proof of
    // fraud and this must never gate anything on its own.
    assert.equal(mobileHashMatches(null, "+919811000010"), null);
    assert.equal(mobileHashMatches("ab".repeat(32), "not-a-phone"), null);
  });

  test("a plain SHA-256 of the last ten digits matches when that is the construction", () => {
    const digits = "9811000010";
    const { payload, publicKeyPem } = buildPayload({ mobileDigits: digits });
    const r = verifySecureQr(payload, [asCertificate(publicKeyPem)]);
    assert.equal(mobileHashMatches(r.hashes.mobile, `+91${digits}`), true);
    assert.equal(mobileHashMatches(r.hashes.mobile, "+919999999999"), false);
  });
});
