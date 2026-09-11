/**
 * Loads the UIDAI document-signer certificates from disk.
 *
 * A directory rather than one file, because UIDAI rotates the signer and a QR
 * issued under the previous certificate must keep verifying. Every certificate
 * present is tried, and the one that matched is reported back — which is what
 * makes a verification auditable a year later.
 *
 * Nothing here signs anything. These are public certificates and the only
 * operation performed with them is signature verification.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { X509Certificate, type KeyObject } from "node:crypto";

export interface LoadedCertificate {
  /** File name, reported to the client as `certificateFile`. */
  file: string;
  subject: string;
  issuer: string;
  validFrom: Date;
  validTo: Date;
  publicKey: KeyObject;
  fingerprint256: string;
}

const CERT_DIR = join(dirname(fileURLToPath(import.meta.url)), "certs");

let cache: LoadedCertificate[] | null = null;

/**
 * Every certificate in the directory, newest expiry first.
 *
 * Read once and held: these change only on redeploy, and re-reading them per
 * request would put disk I/O on the verification path for no benefit.
 */
export function loadCertificates(): LoadedCertificate[] {
  if (cache) return cache;

  let files: string[];
  try {
    files = readdirSync(CERT_DIR).filter((f) => f.toLowerCase().endsWith(".cer") || f.toLowerCase().endsWith(".pem"));
  } catch {
    // No directory at all. Verification then fails closed, which is correct —
    // but it is worth saying loudly, because the symptom (nothing ever
    // verifies) looks identical to a broken parser.
    console.error(`aadhaar: certificate directory missing at ${CERT_DIR}. No Secure QR can be verified.`);
    cache = [];
    return cache;
  }

  const loaded: LoadedCertificate[] = [];
  for (const file of files) {
    try {
      const cert = new X509Certificate(readFileSync(join(CERT_DIR, file)));
      loaded.push({
        file,
        subject: cert.subject.replace(/\n/g, ", "),
        issuer: cert.issuer.replace(/\n/g, ", "),
        validFrom: new Date(cert.validFrom),
        validTo: new Date(cert.validTo),
        publicKey: cert.publicKey,
        fingerprint256: cert.fingerprint256,
      });
    } catch (error) {
      console.error(`aadhaar: could not read certificate ${file}`, error);
    }
  }

  if (loaded.length === 0) {
    console.error(`aadhaar: no usable certificates in ${CERT_DIR}. Scans will parse but never verify.`);
  }

  loaded.sort((a, b) => b.validTo.getTime() - a.validTo.getTime());
  cache = loaded;
  return cache;
}

/** Test seam: forces the next call to re-read the directory. */
export function resetCertificateCache(): void {
  cache = null;
}

/** Whether a certificate is within its validity window right now. */
export function isCurrentlyValid(cert: LoadedCertificate, now: Date = new Date()): boolean {
  return cert.validFrom <= now && now <= cert.validTo;
}
