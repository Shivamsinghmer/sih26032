/**
 * `GET /me` — the first call the web app makes once Clerk reports a session,
 * and everything the router needs to pick a panel and a gate.
 *
 * The rule that matters: `role: null` means this account genuinely has no role
 * (a fresh sign-up), and the client sends it to onboarding. A lookup that
 * *failed* must be a 503 instead, which `resolveSession` and the Prisma error
 * translation both honour. Collapsing the two is what turned an outage into an
 * infinite onboarding redirect in the previous build.
 */

import { Router } from "express";
import type { FarmerDto, Locale, MeResponse, OfficerDto } from "@mandi/shared";
import { prisma } from "../db.js";
import { withSession, sessionOf } from "../auth/require-role.js";

export const meRouter: Router = Router();

meRouter.get("/me", withSession, async (req, res) => {
  const session = sessionOf(req);

  // Both lookups are by clerkId — identity comes from the session and never
  // from the request body. Accepting an id here would let any signed-in user
  // read someone else's profile.
  const [farmerRow, officerRow] = await Promise.all([
    session.role === "farmer"
      ? prisma.farmer.findUnique({ where: { clerkId: session.userId } })
      : null,
    session.role === "officer" || session.role === "admin"
      ? prisma.officer.findUnique({
          where: { clerkId: session.userId },
          include: { centre: { select: { id: true, name: true } } },
        })
      : null,
  ]);

  const farmer: FarmerDto | null = farmerRow
    ? {
        id: farmerRow.id,
        name: farmerRow.name,
        village: farmerRow.village,
        district: farmerRow.district,
        state: farmerRow.state,
        landAcres: farmerRow.landAcres,
        landVerified: farmerRow.landVerified,
        aadhaarVerified: farmerRow.aadhaarVerified,
        preferredLocale: farmerRow.preferredLocale as Locale,
      }
    : null;

  const officer: OfficerDto | null = officerRow
    ? {
        id: officerRow.id,
        name: officerRow.name,
        centreId: officerRow.centre?.id ?? null,
        centreName: officerRow.centre?.name ?? null,
      }
    : null;

  const body: MeResponse = {
    userId: session.userId,
    role: session.role,
    demoMode: session.demoMode,
    gates: {
      // A farmer with a role but no row has signed up and stopped. An officer
      // is provisioned by hand in the Clerk dashboard, so their profile exists
      // by the time the role does.
      hasProfile: session.role === "farmer" ? farmer !== null : officer !== null,
      // Blocks every /farmer route. Only a UIDAI-signed Secure QR sets it.
      aadhaarVerified: farmer?.aadhaarVerified ?? false,
    },
    farmer,
    officer,
  };

  res.json(body);
});
