/**
 * The farmer panel's read endpoints, plus booking.
 *
 * Every handler resolves its farmer from the session. None of them accepts a
 * farmer id, which is what stops a signed-in user consuming someone else's
 * seasonal quota.
 */

import { Router } from "express";
import { z } from "zod";
import {
  allocate,
  bookableQuintals,
  deriveStage,
  estimateWaitMinutes,
  paymentStatus,
  CROPS,
  LOCALES,
} from "@mandi/shared";
import { prisma } from "../db.js";
import { withSession, sessionOf } from "../auth/require-role.js";
import { farmerOf, verifiedFarmerOf } from "../auth/identity.js";
import { parseBody, parseQuery } from "../http/validate.js";
import { HttpError, notFound } from "../http/errors.js";
import { startOfDayUtc, endOfDayUtc, parseDateOnly, today } from "../lib/dates.js";
import { notify } from "../lib/notifications.js";
import { activeSeason } from "../lib/season.js";

export const farmerRouter: Router = Router();

/** Both keys are null when there is nothing outstanding. */
farmerRouter.get("/farmer/dashboard", withSession, async (req, res) => {
  const farmer = await farmerOf(sessionOf(req));

  const [nextBooking, latestLot] = await Promise.all([
    prisma.booking.findFirst({
      where: {
        farmerId: farmer.id,
        status: { in: ["BOOKED", "RESLOTTED", "ARRIVED", "IN_PROGRESS"] },
      },
      orderBy: { slotStart: "asc" },
      include: { centre: { select: { id: true, name: true, village: true } } },
    }),
    prisma.lot.findFirst({
      where: { farmerId: farmer.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  res.json({
    nextBooking: nextBooking && {
      id: nextBooking.id,
      tokenNumber: nextBooking.tokenNumber,
      slotStart: nextBooking.slotStart,
      slotEnd: nextBooking.slotEnd,
      status: nextBooking.status,
      // Carried so the panel can render a RESLOTTED booking with its explanation
      // and an instruction not to travel, rather than as a normal slot.
      reslotReason: nextBooking.reslotReason,
      quantityQuintals: nextBooking.quantityQuintals,
      gatePassCode: nextBooking.gatePassCode,
      centre: nextBooking.centre,
    },
    // Stage is derived server-side. Two implementations of one state machine is
    // one too many, so the client never computes this.
    latestLot: latestLot && {
      id: latestLot.id,
      ...paymentStatus(latestLot),
      amountPaise: latestLot.amountPaise?.toString() ?? null,
      jFormNumber: latestLot.jFormNumber,
      jFormIssuedAt: latestLot.jFormIssuedAt,
    },
  });
});

/** The payment tracker: every lot this farmer has, newest first. */
farmerRouter.get("/farmer/lots", withSession, async (req, res) => {
  const farmer = await farmerOf(sessionOf(req));

  const lots = await prisma.lot.findMany({
    where: { farmerId: farmer.id },
    orderBy: { createdAt: "desc" },
    include: { centre: { select: { id: true, name: true } } },
  });

  res.json(
    lots.map((lot) => ({
      id: lot.id,
      centre: lot.centre,
      ...paymentStatus(lot),
      netQuintals: lot.netQuintals,
      // Serialised as a string: JSON has no bigint, and rounding paise through
      // a double is exactly the bug integer paise exists to prevent.
      amountPaise: lot.amountPaise?.toString() ?? null,
      jFormNumber: lot.jFormNumber,
      jFormIssuedAt: lot.jFormIssuedAt,
      liftedAt: lot.liftedAt,
      agencyAckAt: lot.agencyAckAt,
      pfmsBatchAt: lot.pfmsBatchAt,
      creditedAt: lot.creditedAt,
      qualityPass: lot.qualityPass,
      moisturePercent: lot.moisturePercent,
      rejectionReason: lot.rejectionReason,
    })),
  );
});

/**
 * Live queue position and a moving ETA.
 *
 * The ETA is built from the centre's *observed* service rate today, so it
 * self-corrects rather than repeating an optimistic plan.
 */
farmerRouter.get("/farmer/queue-context", withSession, async (req, res) => {
  const farmer = await farmerOf(sessionOf(req));

  const booking = await prisma.booking.findFirst({
    where: { farmerId: farmer.id, status: { in: ["BOOKED", "ARRIVED", "IN_PROGRESS"] } },
    orderBy: { slotStart: "asc" },
    include: { centre: true },
  });

  if (!booking) {
    res.json({ booking: null, queue: null });
    return;
  }

  const dayStart = startOfDayUtc(booking.slotStart);
  const dayEnd = endOfDayUtc(booking.slotStart);

  const [served, ahead, nowServing] = await Promise.all([
    prisma.booking.count({
      where: {
        centreId: booking.centreId,
        status: "COMPLETED",
        slotStart: { gte: dayStart, lte: dayEnd },
      },
    }),
    // Ahead of this farmer: earlier slots on the same day still unfinished.
    prisma.booking.count({
      where: {
        centreId: booking.centreId,
        status: { in: ["ARRIVED", "IN_PROGRESS", "BOOKED"] },
        slotStart: { gte: dayStart, lt: booking.slotStart },
      },
    }),
    prisma.booking.findFirst({
      where: {
        centreId: booking.centreId,
        status: "IN_PROGRESS",
        slotStart: { gte: dayStart, lte: dayEnd },
      },
      orderBy: { slotStart: "asc" },
      select: { tokenNumber: true },
    }),
  ]);

  const openedAt = new Date(dayStart);
  openedAt.setUTCHours(booking.centre.openHour, 0, 0, 0);
  const minutesElapsedToday = Math.max(0, (Date.now() - openedAt.getTime()) / 60000);

  // The planning figure: a serial weighbridge at ~12 minutes a lot, divided by
  // however many bridges the centre runs.
  const fallbackMinutesPerLot = 12 / Math.max(1, booking.centre.weighbridgeCount);

  const eta = estimateWaitMinutes(
    { servedSoFar: served, minutesElapsedToday, positionInQueue: ahead },
    fallbackMinutesPerLot,
  );

  res.json({
    booking: {
      id: booking.id,
      tokenNumber: booking.tokenNumber,
      slotStart: booking.slotStart,
      status: booking.status,
      gatePassCode: booking.gatePassCode,
      reslotReason: booking.reslotReason,
      centre: { id: booking.centre.id, name: booking.centre.name, village: booking.centre.village },
    },
    queue: {
      nowServingToken: nowServing?.tokenNumber ?? null,
      ahead,
      servedToday: served,
      etaMinutes: eta.minutes,
      observedMinutesPerLot: eta.observedMinutesPerLot,
      // Lets the panel say "based on today's pace" rather than implying a
      // precision the first few lots of the morning cannot support.
      etaFromObservedRate: eta.fromObservedRate,
    },
  });
});

/** The booking form's centre list. */
farmerRouter.get("/centres", withSession, async (_req, res) => {
  const centres = await prisma.centre.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, code: true, village: true, district: true, state: true,
      openHour: true, closeHour: true, latitude: true, longitude: true,
    },
  });
  res.json(centres);
});

const slotsQuery = z.object({
  centreId: z.string().min(1),
  date: z.string().optional(),
});

/**
 * Bookable days at a centre.
 *
 * **A day that cannot absorb the farmer's quantity is absent from the list.**
 * The system never shows a slot it cannot keep, which is the difference between
 * this and a portal that publishes a flat quota and discovers the shortfall at
 * the gate.
 */
farmerRouter.get("/slots", withSession, async (req, res) => {
  const farmer = await farmerOf(sessionOf(req));
  const query = parseQuery(slotsQuery, req);

  const from = parseDateOnly(query.date) ?? today();
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 7);

  const days = await prisma.capacityDay.findMany({
    where: {
      centreId: query.centreId,
      // Only PUBLISHED days are bookable. A draft is the officer's working copy
      // and no farmer sees it.
      status: "PUBLISHED",
      date: { gte: from, lte: to },
    },
    orderBy: { date: "asc" },
    include: { centre: { select: { openHour: true, closeHour: true } } },
  });

  const results = [];
  for (const day of days) {
    const capacity = bookableQuintals(day);
    const offered = allocate(capacity).offeredQuintals;

    const booked = await prisma.booking.aggregate({
      where: { capacityDayId: day.id, status: { in: ["BOOKED", "ARRIVED", "IN_PROGRESS", "COMPLETED"] } },
      _sum: { quantityQuintals: true },
    });
    const used = booked._sum.quantityQuintals ?? 0;
    const remaining = Math.round((offered - used) * 10) / 10;

    results.push({
      date: day.date,
      capacityDayId: day.id,
      sellableQuintals: capacity,
      offeredQuintals: offered,
      remainingQuintals: Math.max(0, remaining),
      bindingConstraint: day.bindingConstraint,
      openHour: day.centre.openHour,
      closeHour: day.centre.closeHour,
    });
  }

  res.json({
    // Echoed so the client can filter honestly rather than guessing what the
    // farmer is entitled to sell.
    landAcres: farmer.landAcres,
    landVerified: farmer.landVerified,
    days: results,
  });
});

const bookingSchema = z.object({
  centreId: z.string().min(1),
  slotStart: z.string().datetime({ offset: true }).or(z.string().datetime()),
  quantityQuintals: z.number().positive().max(2000),
  crop: z.enum(CROPS),
});

/**
 * Books a slot.
 *
 * 409 when capacity moved underneath the request, naming what changed so the
 * client can re-render the day rather than show a bare failure.
 */
farmerRouter.post("/bookings", withSession, async (req, res) => {
  // The Aadhaar gate applies here, not merely to the panel: this is the handler
  // that consumes quota.
  const farmer = await verifiedFarmerOf(sessionOf(req));
  const body = parseBody(bookingSchema, req);

  const slotStart = new Date(body.slotStart);
  const date = startOfDayUtc(slotStart);

  const day = await prisma.capacityDay.findUnique({
    where: { centreId_date: { centreId: body.centreId, date } },
    include: { centre: true },
  });

  if (!day || day.status !== "PUBLISHED") {
    throw new HttpError(409, "slot_gone", "That day is no longer open for booking at this centre.");
  }

  // Verified acreage caps what may be sold at MSP — the same rule Odisha's token
  // quota applies, but computed from the actual land record rather than a flat
  // cap, which is the failure that left ~7,000 Bargarh farmers holding grain.
  if (farmer.landVerified && farmer.landAcres) {
    const seasonCap = farmer.landAcres * 25; // generous per-acre ceiling
    const soldThisSeason = await prisma.booking.aggregate({
      where: { farmerId: farmer.id, status: { in: ["BOOKED", "ARRIVED", "IN_PROGRESS", "COMPLETED"] } },
      _sum: { quantityQuintals: true },
    });
    const already = soldThisSeason._sum.quantityQuintals ?? 0;
    if (already + body.quantityQuintals > seasonCap) {
      throw new HttpError(
        409,
        "capacity_moved",
        `Your verified holding of ${farmer.landAcres} acres allows about ${Math.round(seasonCap)} quintals this season, and ${Math.round(already)} are already booked.`,
      );
    }
  }

  const capacity = bookableQuintals(day);
  const offered = allocate(capacity).offeredQuintals;

  const booked = await prisma.booking.aggregate({
    where: { capacityDayId: day.id, status: { in: ["BOOKED", "ARRIVED", "IN_PROGRESS", "COMPLETED"] } },
    _sum: { quantityQuintals: true },
  });
  const used = booked._sum.quantityQuintals ?? 0;

  if (used + body.quantityQuintals > offered) {
    throw new HttpError(
      409,
      "capacity_moved",
      `Only ${Math.max(0, Math.round((offered - used) * 10) / 10)} quintals remain on that day. Choose another day or reduce the quantity.`,
    );
  }

  // Confirm the season exists before issuing a gate pass: a booking for a crop
  // with no notified MSP cannot be priced when it arrives.
  await activeSeason(body.crop, day.centre.state);

  const tokenNumber =
    (await prisma.booking.count({ where: { capacityDayId: day.id } })) + 1;

  const booking = await prisma.booking.create({
    data: {
      farmerId: farmer.id,
      centreId: body.centreId,
      capacityDayId: day.id,
      slotStart,
      slotEnd: new Date(slotStart.getTime() + 30 * 60 * 1000),
      crop: body.crop,
      quantityQuintals: body.quantityQuintals,
      status: "BOOKED",
      tokenNumber,
      gatePassCode: `${day.centre.code}-${Date.now().toString(36).toUpperCase().slice(-6)}`,
    },
    include: { centre: { select: { id: true, name: true } } },
  });

  await notify({
    farmerId: farmer.id,
    template: "SLOT_CONFIRMED",
    vars: {
      centre: day.centre.name,
      date: date.toISOString().slice(0, 10),
      time: slotStart.toISOString().slice(11, 16),
      gatePass: booking.gatePassCode,
      quantity: body.quantityQuintals,
    },
  });

  res.status(201).json({ booking });
});

const localeSchema = z.object({ preferredLocale: z.enum(LOCALES) });

/**
 * Changes the farmer's language.
 *
 * It drives which notification template renders, so this is not a cosmetic
 * client-side toggle — the choice has to reach the server or the SMS keeps
 * arriving in a language the farmer cannot read.
 */
farmerRouter.patch("/farmer/locale", withSession, async (req, res) => {
  const farmer = await farmerOf(sessionOf(req));
  const body = parseBody(localeSchema, req);

  const updated = await prisma.farmer.update({
    where: { id: farmer.id },
    data: { preferredLocale: body.preferredLocale },
    select: { preferredLocale: true },
  });

  res.json(updated);
});

/** Cancelling frees the quantity back to the day. */
farmerRouter.post("/bookings/:id/cancel", withSession, async (req, res) => {
  const farmer = await farmerOf(sessionOf(req));
  const id = String(req.params["id"]);

  const booking = await prisma.booking.findUnique({ where: { id } });
  // Scoped to the caller's own farmer id: an id in the URL is a request, never
  // a grant.
  if (!booking || booking.farmerId !== farmer.id) throw notFound("No such booking.");

  if (!["BOOKED", "RESLOTTED"].includes(booking.status)) {
    throw new HttpError(409, "slot_gone", "This booking can no longer be cancelled.");
  }

  const updated = await prisma.booking.update({
    where: { id },
    data: { status: "CANCELLED" },
  });
  res.json({ booking: updated });
});

/** Exposed for the payment tracker's stage labels; derived, never stored as truth. */
export { deriveStage };
