/**
 * `POST /verify/aadhaar` — the identity-proofing gate.
 *
 * Verification runs on the server and only there. The client's entire job is to
 * read the QR with a camera and post the digit string; a client that verified
 * its own Aadhaar would be theatre, since anyone can skip it.
 */

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { withSession, sessionOf } from "../auth/require-role.js";
import { farmerOf } from "../auth/identity.js";
import { parseBody } from "../http/validate.js";
import { HttpError } from "../http/errors.js";
import { verifySecureQr, mobileHashMatches, QrParseError } from "../lib/aadhaar/secure-qr.js";
import { loadCertificates } from "../lib/aadhaar/cert-store.js";

export const verifyRouter: Router = Router();

const qrSchema = z.object({
  // The raw digit string off the QR. Long — a Secure QR is a few thousand digits.
  qrPayload: z.string().min(64, "That QR payload is too short to be an Aadhaar Secure QR.").max(20_000),
});

verifyRouter.post("/verify/aadhaar", withSession, async (req, res) => {
  const farmer = await farmerOf(sessionOf(req));
  const body = parseBody(qrSchema, req);

  let result;
  try {
    result = verifySecureQr(body.qrPayload);
  } catch (error) {
    if (error instanceof QrParseError) {
      // 422: well-formed request, unprocessable content.
      throw new HttpError(422, "qr_unparseable", error.message);
    }
    throw error;
  }

  // Advisory only — the hashing construction must be confirmed against UIDAI's
  // specification before it can gate anything. See AUTH.md, "the verification chain".
  const mobileMatch = mobileHashMatches(result.hashes.mobile, farmer.phone);

  // Only a genuine UIDAI signature opens the gate. A scan that parsed but did
  // not verify updates nothing: a missing or non-matching certificate must never
  // silently upgrade an unchecked scan.
  if (result.signatureVerified) {
    await prisma.farmer.update({
      where: { id: farmer.id },
      data: {
        aadhaarVerified: true,
        aadhaarLast4: result.identity.aadhaarLast4,
        aadhaarRefId: result.identity.referenceId,
        aadhaarVerifiedAt: new Date(),
        verificationMethod: "AADHAAR_SECURE_QR",
      },
    });
  }

  res.json({
    signatureVerified: result.signatureVerified,
    certificateFile: result.certificateFile,
    message: result.message,
    // Returned even when unverified, so an officer can see what was read.
    // The embedded photo is deliberately never included.
    identity: {
      name: result.identity.name,
      dateOfBirth: result.identity.dateOfBirth,
      gender: result.identity.gender,
      district: result.identity.district,
      state: result.identity.state,
      pincode: result.identity.pincode,
      aadhaarLast4: result.identity.aadhaarLast4,
      issuedAt: result.identity.issuedAt,
    },
    checks: {
      mobileHashPresent: result.hashes.mobile !== null,
      /** null = could not be evaluated. Advisory until the construction is confirmed. */
      mobileMatchesRegisteredPhone: mobileMatch,
    },
  });
});

/**
 * `GET /verify/aadhaar/status` — which certificates this server holds.
 *
 * Exposed because the failure it diagnoses is otherwise invisible: with no
 * certificate installed every scan fails closed, which looks exactly like a
 * broken parser. Metadata only — these are public certificates, and no key
 * material is returned.
 */
verifyRouter.get("/verify/aadhaar/status", withSession, async (_req, res) => {
  const certs = loadCertificates();
  res.json({
    certificatesInstalled: certs.length,
    certificates: certs.map((c) => ({
      file: c.file,
      subject: c.subject,
      issuer: c.issuer,
      validFrom: c.validFrom,
      validTo: c.validTo,
      fingerprint256: c.fingerprint256,
      currentlyValid: c.validFrom <= new Date() && new Date() <= c.validTo,
    })),
  });
});
