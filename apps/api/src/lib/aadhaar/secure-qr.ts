/**
 * Aadhaar Secure QR — parsing and signature verification.
 *
 * Runs **entirely offline**: no UIDAI API, no AUA/KUA licence, no network call
 * to any government server. Only a public certificate on disk.
 *
 * "Offline" means UIDAI is never contacted. It does not mean this may run on the
 * farmer's phone: verification happens here, on the server, and must stay here.
 * A client that decides its own Aadhaar is valid is not a check, because the
 * bundle is editable by the person being checked.
 *
 * Layout of the payload, per UIDAI's Secure QR specification:
 *
 *   digits → BigInt → bytes → gunzip →
 *     [ indicator ] 0xFF [ referenceId ] 0xFF [ name ] 0xFF … 16 text fields …
 *     [ JPEG-2000 photo ]
 *     [ 32-byte SHA-256 email hash ]   (only when the indicator says so)
 *     [ 32-byte SHA-256 mobile hash ]  (only when the indicator says so)
 *     [ 256-byte RSA signature ]
 *
 *   signed data = everything except the trailing 256-byte signature
 *   algorithm   = SHA256withRSA
 *
 * The constants below encode that layout. If UIDAI revises the format, this is
 * the file that changes — and `npm run test:qr` is how you find out.
 */

import { createVerify, createHash, timingSafeEqual } from "node:crypto";
import { gunzipSync, inflateSync, inflateRawSync } from "node:zlib";
import { loadCertificates, isCurrentlyValid, type LoadedCertificate } from "./cert-store.js";

const DELIMITER = 0xff;
const SIGNATURE_BYTES = 256;
const HASH_BYTES = 32;

/** The 16 delimited text fields, in specification order. */
const TEXT_FIELDS = [
  "indicator",
  "referenceId",
  "name",
  "dob",
  "gender",
  "careOf",
  "district",
  "landmark",
  "house",
  "location",
  "pincode",
  "postOffice",
  "state",
  "street",
  "subDistrict",
  "vtc",
] as const;

type TextField = (typeof TEXT_FIELDS)[number];

export class QrParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QrParseError";
  }
}

/**
 * What is kept from a scan.
 *
 * **Never an Aadhaar number** — the QR does not contain one, only the last four
 * digits inside the reference ID, so the UIDAI Data Vault requirement never
 * applies. The embedded photo is deliberately not exposed either; nothing in
 * this flow needs it.
 */
export interface AadhaarIdentity {
  name: string;
  dateOfBirth: string;
  gender: string;
  careOf: string;
  house: string;
  street: string;
  landmark: string;
  location: string;
  vtc: string;
  subDistrict: string;
  district: string;
  state: string;
  pincode: string;
  postOffice: string;
  /** From the reference ID. The only part of the number the QR carries. */
  aadhaarLast4: string;
  /** Last 4 digits + the issue timestamp. Stored for audit. */
  referenceId: string;
  /** When UIDAI generated this QR, parsed from the reference ID. */
  issuedAt: Date | null;
}

export interface VerificationResult {
  /** The whole point. False unless a UIDAI certificate verified the signature. */
  signatureVerified: boolean;
  /** Which certificate matched. Null when none did. */
  certificateFile: string | null;
  identity: AadhaarIdentity;
  /** Present only when the QR carries them; used to bind the phone to the identity. */
  hashes: { email: string | null; mobile: string | null };
  message: string;
}

/** Decimal digit string → the compressed byte array it encodes. */
function digitsToBytes(payload: string): Buffer {
  const digits = payload.trim();
  if (!/^\d+$/.test(digits)) {
    throw new QrParseError("That does not look like an Aadhaar Secure QR. Expected a long string of digits.");
  }
  if (digits.length < 64) {
    throw new QrParseError("That QR payload is too short to be an Aadhaar Secure QR.");
  }

  let hex = BigInt(digits).toString(16);
  if (hex.length % 2 === 1) hex = "0" + hex;
  return Buffer.from(hex, "hex");
}

/**
 * UIDAI compresses with GZIP. Raw deflate and zlib-wrapped deflate are tried as
 * fallbacks rather than assumed absent — the failure mode when the wrapper
 * differs is an unhelpful "incorrect header check", and covering all three costs
 * nothing.
 */
function decompress(raw: Buffer): Buffer {
  const attempts: Array<[string, (b: Buffer) => Buffer]> = [
    ["gunzip", gunzipSync],
    ["inflate", inflateSync],
    ["inflateRaw", inflateRawSync],
  ];
  const errors: string[] = [];
  for (const [name, fn] of attempts) {
    try {
      return fn(raw);
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new QrParseError(`The QR data could not be decompressed (${errors.join("; ")}).`);
}

/** Reference IDs carry DDMMYYYYHHMMSSmmm after the four digits. */
function parseIssuedAt(referenceId: string): Date | null {
  const stamp = referenceId.slice(4);
  if (stamp.length < 14) return null;
  const [dd, mm, yyyy, hh, mi, ss] = [
    stamp.slice(0, 2), stamp.slice(2, 4), stamp.slice(4, 8),
    stamp.slice(8, 10), stamp.slice(10, 12), stamp.slice(12, 14),
  ];
  const iso = `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * How many 32-byte hashes sit before the signature.
 * 0 = neither, 1 = email only, 2 = mobile only, 3 = both.
 */
function hashCount(indicator: string): { email: boolean; mobile: boolean } {
  switch (indicator.trim()) {
    case "1": return { email: true, mobile: false };
    case "2": return { email: false, mobile: true };
    case "3": return { email: true, mobile: true };
    default: return { email: false, mobile: false };
  }
}

/**
 * Parses a Secure QR payload and verifies its signature.
 *
 * A payload that parses but is not signed by UIDAI returns
 * `signatureVerified: false` **with** the identity, so an officer can see what
 * was read — but the farmer stays unverified. A missing or non-matching
 * certificate can never silently upgrade an unchecked scan.
 *
 * Throws `QrParseError` only when the payload cannot be read at all, which the
 * route maps to 422.
 */
export function verifySecureQr(
  payload: string,
  /**
   * Certificates to verify against. Defaults to whatever is installed on disk;
   * tests pass their own so the *positive* path can be proven without a real
   * Aadhaar card — otherwise the only thing ever exercised is rejection.
   */
  certificates: LoadedCertificate[] = loadCertificates(),
): VerificationResult {
  const data = decompress(digitsToBytes(payload));

  // --- text region -------------------------------------------------------
  const values: Partial<Record<TextField, string>> = {};
  let cursor = 0;
  let fieldIndex = 0;

  while (fieldIndex < TEXT_FIELDS.length) {
    const next = data.indexOf(DELIMITER, cursor);
    if (next === -1) {
      throw new QrParseError(
        `The QR data ended after ${fieldIndex} of ${TEXT_FIELDS.length} expected fields. It may be truncated, or not an Aadhaar Secure QR.`,
      );
    }
    values[TEXT_FIELDS[fieldIndex]!] = data.subarray(cursor, next).toString("utf8");
    cursor = next + 1;
    fieldIndex += 1;
  }

  const referenceId = values.referenceId ?? "";
  if (referenceId.length < 4) {
    throw new QrParseError("The QR carried no usable reference ID.");
  }

  // --- trailing region ---------------------------------------------------
  if (data.length < SIGNATURE_BYTES + cursor) {
    throw new QrParseError("The QR data is too short to contain a signature.");
  }

  const signature = data.subarray(data.length - SIGNATURE_BYTES);
  const signedData = data.subarray(0, data.length - SIGNATURE_BYTES);

  const present = hashCount(values.indicator ?? "0");
  const hashesPresent = (present.email ? 1 : 0) + (present.mobile ? 1 : 0);
  let hashEnd = data.length - SIGNATURE_BYTES;

  let mobileHash: string | null = null;
  let emailHash: string | null = null;

  if (hashesPresent > 0 && hashEnd - hashesPresent * HASH_BYTES >= cursor) {
    // Order is email then mobile, so read backwards from the signature.
    if (present.mobile) {
      mobileHash = data.subarray(hashEnd - HASH_BYTES, hashEnd).toString("hex");
      hashEnd -= HASH_BYTES;
    }
    if (present.email) {
      emailHash = data.subarray(hashEnd - HASH_BYTES, hashEnd).toString("hex");
      hashEnd -= HASH_BYTES;
    }
  }

  // --- signature ---------------------------------------------------------
  const { verified, certificate } = verifyAgainstCertificates(signedData, signature, certificates);

  const identity: AadhaarIdentity = {
    name: values.name ?? "",
    dateOfBirth: values.dob ?? "",
    gender: values.gender ?? "",
    careOf: values.careOf ?? "",
    house: values.house ?? "",
    street: values.street ?? "",
    landmark: values.landmark ?? "",
    location: values.location ?? "",
    vtc: values.vtc ?? "",
    subDistrict: values.subDistrict ?? "",
    district: values.district ?? "",
    state: values.state ?? "",
    pincode: values.pincode ?? "",
    postOffice: values.postOffice ?? "",
    aadhaarLast4: referenceId.slice(0, 4),
    referenceId,
    issuedAt: parseIssuedAt(referenceId),
  };

  return {
    signatureVerified: verified,
    certificateFile: certificate?.file ?? null,
    identity,
    hashes: { email: emailHash, mobile: mobileHash },
    message: verified
      ? `Signature verified against ${certificate!.file}. This Aadhaar was issued by UIDAI and has not been altered.`
      : describeFailure(certificates),
  };
}

/** Tries every installed certificate; the first that verifies wins. */
function verifyAgainstCertificates(
  signedData: Buffer,
  signature: Buffer,
  certificates: LoadedCertificate[],
): { verified: boolean; certificate: LoadedCertificate | null } {
  for (const cert of certificates) {
    try {
      const verifier = createVerify("RSA-SHA256");
      verifier.update(signedData);
      verifier.end();
      if (verifier.verify(cert.publicKey, signature)) {
        // An expired signer is worth knowing about, but it does not invalidate a
        // QR that was signed while the certificate was live.
        if (!isCurrentlyValid(cert)) {
          console.warn(`aadhaar: verified against ${cert.file}, which is outside its validity window.`);
        }
        return { verified: true, certificate: cert };
      }
    } catch {
      // Wrong key for this signature — try the next certificate.
    }
  }
  return { verified: false, certificate: null };
}

function describeFailure(installed: LoadedCertificate[]): string {
  if (installed.length === 0) {
    return "This QR was read, but no UIDAI certificate is installed on the server, so the signature could not be checked. The farmer remains unverified.";
  }
  return `This QR was read, but its signature did not match any of the ${installed.length} installed UIDAI certificate(s). It may be a sample or a modified payload. The farmer remains unverified.`;
}

/**
 * Binds the phone Clerk verified to the identity UIDAI holds.
 *
 * The QR carries a SHA-256 of the registered mobile, so the number the farmer
 * just proved control of can be tested against it. Step 2 alone proves the
 * *document* is genuine — never that the person presenting it owns it — and
 * this is what closes that gap.
 *
 * The exact construction is UIDAI's and must be confirmed against their
 * specification before this is relied on: it is a salted/repeated SHA-256 over
 * the mobile digits, not a plain one, so a mismatch here is not proof of fraud.
 * Returned as advisory for now.
 */
export function mobileHashMatches(qrMobileHash: string | null, phone: string): boolean | null {
  if (!qrMobileHash) return null;

  const digits = phone.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return null;

  const candidate = createHash("sha256").update(digits, "utf8").digest();
  const expected = Buffer.from(qrMobileHash, "hex");
  if (candidate.length !== expected.length) return null;

  return timingSafeEqual(candidate, expected);
}
