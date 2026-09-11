/**
 * Resolving the acting person from the session, and enforcing the two gates.
 *
 * **Identity comes from the session, never the request body.** Every handler
 * resolves its farmer or officer through here. Accepting a `farmerId` from the
 * client would let any signed-in user consume someone else's seasonal quota or
 * attach a scan to another person's record — the single most important rule in
 * this API, and one that matters more after the two-service split rather than
 * less, because the client is now a separate program an attacker fully controls.
 */

import type { Farmer, Officer } from "@prisma/client";
import { prisma } from "../db.js";
import { HttpError, forbiddenRole, notFound } from "../http/errors.js";
import type { Session } from "./session.js";

/**
 * The farmer acting on this request.
 *
 * 403 `gate_profile` when the account has a role but no profile — the client
 * reads that code and routes to /onboarding.
 */
export async function farmerOf(session: Session): Promise<Farmer> {
  const farmer = await prisma.farmer.findUnique({ where: { clerkId: session.userId } });
  if (!farmer) {
    throw new HttpError(403, "gate_profile", "Finish setting up your profile to continue.");
  }
  return farmer;
}

/**
 * The farmer acting on this request, who must have cleared the Aadhaar gate.
 *
 * This is the real gate. The React app has a matching guard so nobody stares at
 * a screen that 403s, but that guard ships in a bundle the user can edit, so the
 * check has to happen here in every farmer handler that does anything.
 */
export async function verifiedFarmerOf(session: Session): Promise<Farmer> {
  const farmer = await farmerOf(session);
  if (!farmer.aadhaarVerified) {
    throw new HttpError(
      403,
      "gate_aadhaar",
      "Verify your Aadhaar to book a slot. Scan the Secure QR on your Aadhaar card.",
    );
  }
  return farmer;
}

/** The officer or admin acting on this request. */
export async function officerOf(session: Session): Promise<Officer> {
  const officer = await prisma.officer.findUnique({ where: { clerkId: session.userId } });
  if (!officer) {
    throw forbiddenRole("This account is not registered as a centre officer.");
  }
  return officer;
}

/**
 * Authorises an officer against one centre.
 *
 * A district admin reaches every centre; an officer reaches only their own.
 * Without this, any officer could publish capacity for a centre they have
 * nothing to do with and re-slot its farmers — the role check alone is not
 * enough, because `requireRole("officer")` says *what kind* of user this is,
 * not *which centre* they are responsible for.
 */
export async function assertCentreAccess(session: Session, centreId: string): Promise<Officer> {
  const officer = await officerOf(session);

  if (officer.role === "admin") return officer;

  if (officer.centreId !== centreId) {
    // 403 rather than 404: the centre plainly exists, and pretending otherwise
    // would make a misconfigured officer account impossible to diagnose.
    throw forbiddenRole("You are not assigned to that procurement centre.");
  }
  return officer;
}

/** Loads a centre or 404s, so handlers do not each repeat the null check. */
export async function centreOrThrow(centreId: string) {
  const centre = await prisma.centre.findUnique({ where: { id: centreId } });
  if (!centre) throw notFound("No such procurement centre.");
  return centre;
}
