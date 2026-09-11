/**
 * `npm run test:qr` — exercises the whole Secure QR pipeline and prints which
 * certificates are installed.
 *
 * `npm run test:qr -- --emit` prints a sample payload for testing the scanner's
 * paste box. **It always reports NOT VERIFIED, by design**: it is signed by a
 * throwaway key generated on the spot, not by UIDAI. That is the correct
 * outcome, and demonstrating it is the point — a pipeline that "verified" a
 * self-signed payload would be worthless.
 *
 * A real end-to-end verification therefore needs a real Aadhaar card, or demo
 * mode, which skips the gate along with all auth.
 */

import { generateKeyPairSync, createSign } from "node:crypto";
import { gzipSync } from "node:zlib";
import { verifySecureQr, QrParseError } from "../src/lib/aadhaar/secure-qr.js";
import { loadCertificates } from "../src/lib/aadhaar/cert-store.js";

const DELIM = Buffer.from([0xff]);

/** Builds a structurally valid Secure QR payload, signed by a throwaway key. */
function emitSample(): string {
  const fields = [
    "2",                       // indicator: mobile hash present
    "705811092026120000000",   // reference id: last4 + DDMMYYYYHHMMSSmmm (11-09-2026)
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

  const text = Buffer.concat(fields.flatMap((f) => [Buffer.from(f, "utf8"), DELIM]));
  const photo = Buffer.alloc(64, 0x7a);          // stand-in for the JPEG-2000 photo
  const mobileHash = Buffer.alloc(32, 0x11);     // stand-in for the SHA-256 mobile hash
  const body = Buffer.concat([text, photo, mobileHash]);

  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const signer = createSign("RSA-SHA256");
  signer.update(body);
  signer.end();
  const signature = signer.sign(privateKey); // 256 bytes

  const compressed = gzipSync(Buffer.concat([body, signature]));
  return BigInt("0x" + compressed.toString("hex")).toString(10);
}

function printCertificates(): boolean {
  const certs = loadCertificates();
  console.log(`\nCERTIFICATES INSTALLED: ${certs.length}`);
  for (const c of certs) {
    const live = c.validFrom <= new Date() && new Date() <= c.validTo;
    console.log(`  ${c.file}`);
    console.log(`    subject  ${c.subject}`);
    console.log(`    issuer   ${c.issuer}`);
    console.log(`    valid    ${c.validFrom.toISOString().slice(0, 10)} -> ${c.validTo.toISOString().slice(0, 10)}  ${live ? "(current)" : "(OUTSIDE WINDOW)"}`);
    console.log(`    sha256   ${c.fingerprint256}`);
  }
  if (certs.length === 0) {
    console.log("  none — every scan will parse but stay unverified, which is the correct fail-closed behaviour.");
  }
  return certs.length > 0;
}

function main(): void {
  const emit = process.argv.includes("--emit");
  const sample = emitSample();

  if (emit) {
    console.log(sample);
    return;
  }

  console.log("Aadhaar Secure QR — pipeline self-test");
  const haveCerts = printCertificates();

  console.log("\nPARSING a self-signed sample payload");
  console.log(`  payload length: ${sample.length} digits`);

  try {
    const result = verifySecureQr(sample);
    console.log(`  name           ${result.identity.name}`);
    console.log(`  dob            ${result.identity.dateOfBirth}`);
    console.log(`  district       ${result.identity.district}, ${result.identity.state}`);
    console.log(`  aadhaar last4  ${result.identity.aadhaarLast4}`);
    console.log(`  issued at      ${result.identity.issuedAt?.toISOString() ?? "unparsed"}`);
    console.log(`  mobile hash    ${result.hashes.mobile ? "present" : "absent"}`);
    console.log(`\n  SIGNATURE: ${result.signatureVerified ? "VERIFIED" : "NOT VERIFIED"}`);
    console.log(`  ${result.message}`);

    if (result.signatureVerified) {
      console.error("\nFAIL: a self-signed payload verified. The signature check is not working.");
      process.exit(1);
    }

    console.log("\nPASS — parsing works and the self-signed sample is correctly rejected.");
    if (!haveCerts) {
      console.log("NOTE: with no certificate installed this test cannot prove a genuine QR would verify.");
    }
    console.log("A real Aadhaar card is needed to see VERIFIED. Use --emit to get a payload for the scanner's paste box.");
  } catch (error) {
    if (error instanceof QrParseError) {
      console.error(`\nFAIL: the sample did not parse — ${error.message}`);
      console.error("The payload layout in secure-qr.ts and the one built here have drifted apart.");
      process.exit(1);
    }
    throw error;
  }
}

main();
