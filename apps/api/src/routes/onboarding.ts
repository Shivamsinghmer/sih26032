/**
 * Onboarding — creating the farmer profile and self-assigning the `farmer` role.
 *
 * **Only `farmer` is self-assignable.** Officer and admin are granted by a person
 * in the Clerk dashboard, because a public form that hands out officer rights
 * would let anyone publish a centre's capacity and re-slot real farmers.
 */

import { Router } from "express";
import { z } from "zod";
import { clerkClient } from "@clerk/express";
import { LOCALES } from "@mandi/shared";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { withSession, sessionOf } from "../auth/require-role.js";
import { forgetRole } from "../auth/session.js";
import { parseBody } from "../http/validate.js";
import { HttpError, upstreamUnavailable } from "../http/errors.js";

export const onboardingRouter: Router = Router();

const onboardingSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name.").max(120),
  village: z.string().trim().min(1, "Enter your village.").max(120),
  district: z.string().trim().min(1, "Enter your district.").max(120),
  state: z.string().trim().min(1, "Enter your state.").max(120),
  preferredLocale: z.enum(LOCALES).default("hi"),
  // Optional at this step: the land record is a separate part of the chain, and
  // blocking registration on it is what excludes tenant cultivators.
  landAcres: z.number().positive().max(1000).optional(),
});

onboardingRouter.post("/onboarding", withSession, async (req, res) => {
  const session = sessionOf(req);
  const body = parseBody(onboardingSchema, req);

  const existing = await prisma.farmer.findUnique({ where: { clerkId: session.userId } });
  if (existing) {
    throw new HttpError(409, "phone_taken", "This account already has a farmer profile.");
  }

  // The phone comes from the Clerk session, never the body. A client-supplied
  // phone would let someone claim a number they do not control, which is the
  // one thing the OTP step actually established.
  const phone = await sessionPhone(session.userId);

  const taken = await prisma.farmer.findUnique({ where: { phone } });
  if (taken) {
    throw new HttpError(409, "phone_taken", "A farmer is already registered with this phone number.");
  }

  const farmer = await prisma.farmer.create({
    data: {
      clerkId: session.userId,
      phone,
      name: body.name,
      village: body.village,
      district: body.district,
      state: body.state,
      preferredLocale: body.preferredLocale,
      landAcres: body.landAcres ?? null,
      landVerified: false,
      aadhaarVerified: false,
    },
  });

  // Grant the role, then drop any cached miss for this user. Without the
  // invalidation the next request could still read "no role" from the 60s cache
  // and bounce them straight back into onboarding.
  if (!env.demoMode) {
    try {
      await clerkClient.users.updateUser(session.userId, { publicMetadata: { role: "farmer" } });
    } catch (error) {
      console.error("onboarding: failed to set role in Clerk", error);
      throw upstreamUnavailable("Your profile was saved but the account could not be activated. Please try again.");
    }
  }
  forgetRole(session.userId);

  res.status(201).json({ farmer });
});

/** The verified phone on the Clerk account. In demo mode there is no Clerk to ask. */
async function sessionPhone(userId: string): Promise<string> {
  if (env.demoMode) return `+91demo${userId.slice(-6)}`;

  try {
    const user = await clerkClient.users.getUser(userId);
    const phone = user.primaryPhoneNumber?.phoneNumber ?? user.phoneNumbers[0]?.phoneNumber;
    if (!phone) {
      throw new HttpError(400, "validation_failed", "This account has no verified phone number.");
    }
    return phone;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("onboarding: Clerk lookup failed", error);
    throw upstreamUnavailable();
  }
}
