/**
 * The district admin panel. Role `admin` only.
 */

import { Router } from "express";
import { paymentStatus, isBreached } from "@mandi/shared";
import { prisma } from "../db.js";
import { requireRole } from "../auth/require-role.js";
import { today, endOfDayUtc } from "../lib/dates.js";

export const adminRouter: Router = Router();

/** Admin only, per route — see the note in centre.ts on why not `router.use()`. */
const adminOnly = requireRole("admin");

/** Multi-centre dashboard and the aggregate KPIs. */
adminRouter.get("/admin/overview", adminOnly, async (_req, res) => {
  const date = today();

  const centres = await prisma.centre.findMany({ orderBy: { name: "asc" } });

  const perCentre = await Promise.all(
    centres.map(async (centre) => {
      const [capacityDay, bookings, served, breached, awaitingLift] = await Promise.all([
        prisma.capacityDay.findUnique({ where: { centreId_date: { centreId: centre.id, date } } }),
        prisma.booking.count({ where: { centreId: centre.id, slotStart: { gte: date, lte: endOfDayUtc(date) } } }),
        prisma.booking.count({
          where: { centreId: centre.id, status: "COMPLETED", slotStart: { gte: date, lte: endOfDayUtc(date) } },
        }),
        prisma.lot.count({ where: { centreId: centre.id, slaBreached: true, creditedAt: null } }),
        prisma.lot.count({ where: { centreId: centre.id, jFormIssuedAt: { not: null }, liftedAt: null } }),
      ]);

      return {
        centre: { id: centre.id, name: centre.name, code: centre.code, village: centre.village },
        // Null when the officer has not entered today yet — that gap is itself
        // the finding the admin screen should surface, not a zero to gloss over.
        published: capacityDay?.status === "PUBLISHED",
        sellableQuintals: capacityDay?.approvedQuintals ?? capacityDay?.computedQuintals ?? null,
        bindingConstraint: capacityDay?.bindingConstraint ?? null,
        bookingsToday: bookings,
        servedToday: served,
        breachedLots: breached,
        awaitingLift,
      };
    }),
  );

  const [totalFarmers, totalBreached, unpublished] = await Promise.all([
    prisma.farmer.count(),
    prisma.lot.count({ where: { slaBreached: true, creditedAt: null } }),
    Promise.resolve(perCentre.filter((c) => !c.published).length),
  ]);

  // Which resource limited the district most often — the question a procurement
  // officer would want answered before next year's tendering.
  const constraintCounts = await prisma.capacityDay.groupBy({
    by: ["bindingConstraint"],
    where: { status: "PUBLISHED", bindingConstraint: { not: null } },
    _count: { bindingConstraint: true },
  });

  res.json({
    date,
    kpis: {
      centres: centres.length,
      farmers: totalFarmers,
      breachedLots: totalBreached,
      centresNotPublished: unpublished,
      bookingsToday: perCentre.reduce((sum, c) => sum + c.bookingsToday, 0),
      servedToday: perCentre.reduce((sum, c) => sum + c.servedToday, 0),
    },
    centres: perCentre,
    constraintHistory: constraintCounts.map((row) => ({
      constraint: row.bindingConstraint,
      days: row._count.bindingConstraint,
    })),
  });
});

/**
 * Every lot past the 72-hour payment norm, with the stage it is stuck at and the
 * office accountable for it.
 *
 * An escalation without a named office is just a complaint, which is precisely
 * why existing dashboards surface delays and nothing moves.
 */
adminRouter.get("/admin/escalations", adminOnly, async (_req, res) => {
  const now = new Date();

  // Filtered on the stored flag, which the index serves, then re-derived below
  // so a row whose flag is stale cannot show a wrong owner or clock.
  const lots = await prisma.lot.findMany({
    where: { creditedAt: null, jFormIssuedAt: { not: null } },
    include: {
      farmer: { select: { name: true, phone: true, village: true } },
      centre: { select: { id: true, name: true } },
    },
    orderBy: { jFormIssuedAt: "asc" },
  });

  const escalations = lots
    .filter((lot) => isBreached(lot, now))
    .map((lot) => ({
      lotId: lot.id,
      farmer: lot.farmer,
      centre: lot.centre,
      jFormNumber: lot.jFormNumber,
      jFormIssuedAt: lot.jFormIssuedAt,
      amountPaise: lot.amountPaise?.toString() ?? null,
      ...paymentStatus(lot, now),
    }))
    .sort((a, b) => b.hoursOverdue - a.hoursOverdue);

  res.json(escalations);
});
