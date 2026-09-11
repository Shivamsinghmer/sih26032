/**
 * The centre officer panel. Role `officer` or `admin`, and an officer reaches
 * only their own centre.
 */

import { Router } from "express";
import { z } from "zod";
import {
  computeCapacity,
  allocate,
  reslotOverflow,
  reslotReason,
  paymentStatus,
  deriveStage,
  slaDueAt,
  isBreached,
  amountPaise,
  bookableQuintals,
  CROPS,
} from "@mandi/shared";
import { prisma } from "../db.js";
import { requireRole, sessionOf } from "../auth/require-role.js";
import { assertCentreAccess, centreOrThrow } from "../auth/identity.js";
import { parseBody, parseQuery } from "../http/validate.js";
import { HttpError, notFound } from "../http/errors.js";
import { startOfDayUtc, endOfDayUtc, parseDateOnly, today, addDays } from "../lib/dates.js";
import type { Locale } from "@mandi/shared";
import { notify, notifyMany, formatPaise, localisedReslotReason } from "../lib/notifications.js";
import { activeSeason } from "../lib/season.js";
import {
  emitBookingReslotted, emitCapacityUpdate, emitPaymentStage, emitQueueUpdate, emitAdminEscalation,
} from "../realtime.js";

export const centreRouter: Router = Router();

/**
 * Officer-or-admin, applied per route rather than with `router.use()`.
 *
 * A `use()` here would run on every request that merely passes through this
 * router on its way to another one, so an unknown path would answer 401 instead
 * of 404 and an admin request would resolve its role twice.
 *
 * The per-centre check is separate and happens inside each handler, because the
 * role says what kind of user this is, not which centre they are responsible for.
 */
const officerOnly = requireRole("officer", "admin");

/** The officer's landing screen: today's state, plus what is overdue here. */
centreRouter.get("/centres/:id/today", officerOnly, async (req, res) => {
  const centreId = String(req.params["id"]);
  await assertCentreAccess(sessionOf(req), centreId);
  const centre = await centreOrThrow(centreId);

  const date = today();
  const [capacityDay, bookingsToday, breachedLots, awaitingLift] = await Promise.all([
    prisma.capacityDay.findUnique({ where: { centreId_date: { centreId, date } } }),
    prisma.booking.findMany({
      where: { centreId, slotStart: { gte: date, lte: endOfDayUtc(date) } },
      orderBy: [{ slotStart: "asc" }],
      include: { farmer: { select: { id: true, name: true, village: true, phone: true } } },
    }),
    prisma.lot.findMany({
      where: { centreId, slaBreached: true, creditedAt: null },
      include: { farmer: { select: { name: true, village: true } } },
      orderBy: { jFormIssuedAt: "asc" },
    }),
    prisma.lot.count({ where: { centreId, jFormIssuedAt: { not: null }, liftedAt: null } }),
  ]);

  res.json({
    centre,
    capacityDay,
    bookingsToday,
    breachedLots: breachedLots.map((lot) => ({
      id: lot.id,
      farmerName: lot.farmer.name,
      village: lot.farmer.village,
      ...paymentStatus(lot),
      amountPaise: lot.amountPaise?.toString() ?? null,
    })),
    awaitingLift,
  });
});

const capacityQuery = z.object({ date: z.string().optional() });

/** The capacity screen for one day, draft or published. */
centreRouter.get("/centres/:id/capacity", officerOnly, async (req, res) => {
  const centreId = String(req.params["id"]);
  await assertCentreAccess(sessionOf(req), centreId);
  const centre = await centreOrThrow(centreId);

  const query = parseQuery(capacityQuery, req);
  const date = parseDateOnly(query.date) ?? addDays(today(), 1);

  const day = await prisma.capacityDay.findUnique({
    where: { centreId_date: { centreId, date } },
  });

  const booked = day
    ? await prisma.booking.aggregate({
        where: { capacityDayId: day.id, status: { in: ["BOOKED", "ARRIVED", "IN_PROGRESS", "COMPLETED"] } },
        _sum: { quantityQuintals: true },
        _count: true,
      })
    : null;

  res.json({
    centre,
    date,
    capacityDay: day,
    // So the officer can see what a cut would cost before making it.
    booked: {
      quintals: booked?._sum.quantityQuintals ?? 0,
      bookings: booked?._count ?? 0,
    },
  });
});

const capacitySchema = z.object({
  date: z.string(),
  bardanaBags: z.number().int().min(0).max(1_000_000),
  labourGangs: z.number().int().min(0).max(500),
  trucksAssigned: z.number().int().min(0).max(500),
  weighbridgeHours: z.number().min(0).max(24),
  openingBacklogQuintals: z.number().min(0).max(100_000),
  /** The officer's override of the computed figure. */
  approvedQuintals: z.number().min(0).max(100_000).optional(),
  publish: z.boolean().default(false),
});

/**
 * Costs a day and, on publish, re-slots whatever no longer fits.
 *
 * **This is the point of the whole system.** Publishing lower capacity moves the
 * overflow immediately and tells those farmers why, so they find out at home
 * rather than at the gate after a night on the road.
 */
centreRouter.post("/centres/:id/capacity", officerOnly, async (req, res) => {
  const centreId = String(req.params["id"]);
  await assertCentreAccess(sessionOf(req), centreId);
  const centre = await centreOrThrow(centreId);

  const body = parseBody(capacitySchema, req);
  const date = parseDateOnly(body.date);
  if (!date) throw new HttpError(400, "validation_failed", "That date could not be read.");

  // The same pure function the officer's browser just ran as they typed. The
  // server is the authority, but it must not disagree with what they saw.
  const result = computeCapacity({
    bardanaBags: body.bardanaBags,
    labourGangs: body.labourGangs,
    trucksAssigned: body.trucksAssigned,
    weighbridgeHours: body.weighbridgeHours,
    openingBacklogQuintals: body.openingBacklogQuintals,
    weighbridgeCount: centre.weighbridgeCount,
    yardCapacityQuintals: centre.yardCapacityQuintals,
  });

  const status = body.publish ? "PUBLISHED" : "DRAFT";

  const day = await prisma.capacityDay.upsert({
    where: { centreId_date: { centreId, date } },
    create: {
      centreId,
      date,
      bardanaBags: body.bardanaBags,
      labourGangs: body.labourGangs,
      trucksAssigned: body.trucksAssigned,
      weighbridgeHours: body.weighbridgeHours,
      openingBacklogQuintals: body.openingBacklogQuintals,
      computedQuintals: result.sellableQuintals,
      bindingConstraint: result.bindingConstraint,
      breakdown: result.breakdown as unknown as object,
      approvedQuintals: body.approvedQuintals ?? result.sellableQuintals,
      status,
      publishedAt: body.publish ? new Date() : null,
    },
    update: {
      bardanaBags: body.bardanaBags,
      labourGangs: body.labourGangs,
      trucksAssigned: body.trucksAssigned,
      weighbridgeHours: body.weighbridgeHours,
      openingBacklogQuintals: body.openingBacklogQuintals,
      computedQuintals: result.sellableQuintals,
      bindingConstraint: result.bindingConstraint,
      breakdown: result.breakdown as unknown as object,
      approvedQuintals: body.approvedQuintals ?? result.sellableQuintals,
      status,
      publishedAt: body.publish ? new Date() : null,
    },
  });

  // A draft is the officer's working copy. Nothing is re-slotted off it, because
  // nobody has been promised anything yet.
  if (!body.publish) {
    res.json({ ...result, capacityDay: day, reslotted: [], published: false });
    return;
  }

  const offered = allocate(bookableQuintals(day)).offeredQuintals;

  const live = await prisma.booking.findMany({
    where: { capacityDayId: day.id, status: { in: ["BOOKED", "RESLOTTED"] } },
    include: { farmer: { select: { id: true, name: true, preferredLocale: true } } },
  });

  const decision = reslotOverflow(live, offered);
  // English, for logs and for the replay harness. Farmer-facing text is localised below.
  const reason = reslotReason(result.bindingConstraint, centre.name);

  // Move the overflow to the next day that can still take them. Seniority
  // travels with the booking, so a farmer bumped twice is not sent to the back.
  const nextDay = addDays(date, 1);
  const reslotted = [];

  for (const booking of decision.overflow) {
    // Stored in the farmer's own language, because this is the text their panel
    // renders next to the moved slot — not only an internal audit note.
    const localised = localisedReslotReason(
      result.bindingConstraint,
      centre.name,
      booking.farmer.preferredLocale as Locale,
    );
    const moved = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: "RESLOTTED",
        reslotReason: localised,
        reslotCount: { increment: 1 },
        slotStart: new Date(nextDay.getTime() + (booking.slotStart.getTime() - startOfDayUtc(booking.slotStart).getTime())),
        slotEnd: new Date(nextDay.getTime() + (booking.slotEnd.getTime() - startOfDayUtc(booking.slotEnd).getTime())),
        // seniorityAt is deliberately NOT touched: it is the farmer's protection
        // against being moved again.
      },
    });
    reslotted.push({ bookingId: moved.id, farmerId: booking.farmerId, farmerName: booking.farmer.name });
  }

  // Every entry in `reslotted` fires a notification. A silent re-slot is worse
  // than none: the farmer travels anyway.
  await notifyMany(
    decision.overflow.map((booking) => ({
      farmerId: booking.farmerId,
      template: "SLOT_RESLOTTED" as const,
      vars: {
        // The reason already names the centre, so the template no longer repeats it.
        reason: localisedReslotReason(
          result.bindingConstraint,
          centre.name,
          booking.farmer.preferredLocale as Locale,
        ),
        date: nextDay.toISOString().slice(0, 10),
        time: booking.slotStart.toISOString().slice(11, 16),
      },
    })),
  );

  // Push what changed. Emitting AFTER the writes and the notifications, so a
  // client that reacts by re-fetching cannot read a half-applied day.
  const at = new Date().toISOString();
  emitCapacityUpdate({
    centreId,
    date: date.toISOString(),
    sellableQuintals: result.sellableQuintals,
    bindingConstraint: result.bindingConstraint,
    at,
  });
  for (const booking of decision.overflow) {
    emitBookingReslotted({
      bookingId: booking.id,
      farmerId: booking.farmerId,
      centreId,
      previousSlotStart: booking.slotStart.toISOString(),
      slotStart: nextDay.toISOString(),
      status: "RESLOTTED",
      reslotReason: reason,
      at,
    });
  }

  res.json({
    ...result,
    capacityDay: day,
    offeredQuintals: offered,
    keptQuintals: decision.keptQuintals,
    reslotted,
    published: true,
  });
});

/** The day-of queue board. */
centreRouter.get("/centres/:id/queue", officerOnly, async (req, res) => {
  const centreId = String(req.params["id"]);
  await assertCentreAccess(sessionOf(req), centreId);
  const centre = await centreOrThrow(centreId);

  const date = today();
  const bookings = await prisma.booking.findMany({
    where: { centreId, slotStart: { gte: date, lte: endOfDayUtc(date) } },
    orderBy: [{ slotStart: "asc" }],
    include: { farmer: { select: { id: true, name: true, village: true, phone: true } } },
  });

  const served = bookings.filter((b) => b.status === "COMPLETED").length;
  const openedAt = new Date(date);
  openedAt.setUTCHours(centre.openHour, 0, 0, 0);
  const minutesElapsed = Math.max(0, (Date.now() - openedAt.getTime()) / 60000);

  res.json({
    centre,
    bookings,
    stats: {
      total: bookings.length,
      served,
      waiting: bookings.filter((b) => b.status === "ARRIVED").length,
      inProgress: bookings.filter((b) => b.status === "IN_PROGRESS").length,
      noShow: bookings.filter((b) => b.status === "NO_SHOW").length,
      observedMinutesPerLot: served >= 3 ? Math.round((minutesElapsed / served) * 10) / 10 : null,
    },
  });
});

const advanceSchema = z.object({
  bookingId: z.string().min(1),
  action: z.enum(["ARRIVE", "START", "COMPLETE", "NO_SHOW"]),
});

/** Call next / mark arrived / no-show. */
centreRouter.post("/queue/advance", officerOnly, async (req, res) => {
  const body = parseBody(advanceSchema, req);

  const booking = await prisma.booking.findUnique({ where: { id: body.bookingId } });
  if (!booking) throw notFound("No such booking.");
  await assertCentreAccess(sessionOf(req), booking.centreId);

  // The legal transitions. Rejecting the rest here means the queue board cannot
  // be driven into a state the rest of the system does not expect.
  const allowed: Record<string, string[]> = {
    ARRIVE: ["BOOKED", "RESLOTTED"],
    START: ["ARRIVED"],
    COMPLETE: ["IN_PROGRESS"],
    NO_SHOW: ["BOOKED", "RESLOTTED", "ARRIVED"],
  };
  if (!allowed[body.action]!.includes(booking.status)) {
    throw new HttpError(409, "slot_gone", `A booking that is ${booking.status} cannot be marked ${body.action}.`);
  }

  const now = new Date();
  const patch =
    body.action === "ARRIVE" ? { status: "ARRIVED" as const, arrivedAt: now }
    : body.action === "START" ? { status: "IN_PROGRESS" as const, startedAt: now }
    : body.action === "COMPLETE" ? { status: "COMPLETED" as const, completedAt: now }
    : { status: "NO_SHOW" as const };

  const updated = await prisma.booking.update({ where: { id: booking.id }, data: patch });

  // Recomputed from the board rather than guessed, so every watching farmer and
  // the officer's own screen agree on the same figures.
  const date = startOfDayUtc(new Date());
  const [inProgress, waiting, served] = await Promise.all([
    prisma.booking.findFirst({
      where: { centreId: booking.centreId, status: "IN_PROGRESS", slotStart: { gte: date, lte: endOfDayUtc(date) } },
      orderBy: { slotStart: "asc" },
      select: { tokenNumber: true },
    }),
    prisma.booking.count({
      where: { centreId: booking.centreId, status: "ARRIVED", slotStart: { gte: date, lte: endOfDayUtc(date) } },
    }),
    prisma.booking.count({
      where: { centreId: booking.centreId, status: "COMPLETED", slotStart: { gte: date, lte: endOfDayUtc(date) } },
    }),
  ]);

  const centre = await prisma.centre.findUnique({ where: { id: booking.centreId }, select: { openHour: true } });
  const openedAt = new Date(date);
  openedAt.setUTCHours(centre?.openHour ?? 9, 0, 0, 0);
  const minutesElapsed = Math.max(0, (Date.now() - openedAt.getTime()) / 60000);

  emitQueueUpdate({
    centreId: booking.centreId,
    nowServingToken: inProgress?.tokenNumber ?? null,
    waiting,
    observedMinutesPerLot: served >= 3 ? Math.round((minutesElapsed / served) * 10) / 10 : null,
    at: new Date().toISOString(),
  });

  res.json({ booking: updated });
});

const lotSchema = z.object({
  bookingId: z.string().min(1),
  moisturePercent: z.number().min(0).max(100),
  netQuintals: z.number().positive().max(2000),
  crop: z.enum(CROPS).default("PADDY"),
});

/**
 * The quality gate and the J-form, in one write.
 *
 * A failing moisture reading creates a rejected lot, re-slots the booking and
 * notifies — so the farmer learns the new date before leaving the yard rather
 * than making the same wasted trip next week.
 */
centreRouter.post("/lots", officerOnly, async (req, res) => {
  const body = parseBody(lotSchema, req);

  const booking = await prisma.booking.findUnique({
    where: { id: body.bookingId },
    include: { centre: true, farmer: true, lot: true },
  });
  if (!booking) throw notFound("No such booking.");
  await assertCentreAccess(sessionOf(req), booking.centreId);

  if (booking.lot) {
    throw new HttpError(409, "slot_gone", "This booking already has a lot recorded.");
  }

  // The limit lives in SeasonConfig, not in code: it differs by crop and can be
  // relaxed by notification in a bad year.
  const season = await activeSeason(body.crop, booking.centre.state);
  const pass = body.moisturePercent <= season.moistureLimitPercent;

  if (!pass) {
    const nextSlot = addDays(booking.slotStart, 3);
    const lot = await prisma.lot.create({
      data: {
        bookingId: booking.id,
        farmerId: booking.farmerId,
        centreId: booking.centreId,
        moisturePercent: body.moisturePercent,
        qualityPass: false,
        rejectionReason: `Moisture ${body.moisturePercent}% exceeds the ${season.moistureLimitPercent}% limit for ${body.crop.toLowerCase()}.`,
        paymentStage: "AWAITING_JFORM",
      },
    });

    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: "RESLOTTED",
        reslotCount: { increment: 1 },
        reslotReason: `Moisture ${body.moisturePercent}% is above the ${season.moistureLimitPercent}% limit. Re-dry and return.`,
        slotStart: nextSlot,
        slotEnd: new Date(nextSlot.getTime() + 30 * 60 * 1000),
      },
    });

    await notify({
      farmerId: booking.farmerId,
      template: "MOISTURE_FAIL",
      vars: {
        moisture: body.moisturePercent,
        limit: season.moistureLimitPercent,
        date: nextSlot.toISOString().slice(0, 10),
      },
    });

    res.status(201).json({ lot, qualityPass: false, reslotted: true });
    return;
  }

  // Passing: weigh, price at the season MSP, cut the J-form. That timestamp is
  // what starts the 72-hour payment clock.
  const jFormIssuedAt = new Date();
  const value = amountPaise(body.netQuintals, season.mspPaisePerQuintal);
  const jFormNumber = `JF/${booking.centre.code}/${jFormIssuedAt.getUTCFullYear()}/${Date.now().toString(36).toUpperCase().slice(-6)}`;

  const lot = await prisma.lot.create({
    data: {
      bookingId: booking.id,
      farmerId: booking.farmerId,
      centreId: booking.centreId,
      moisturePercent: body.moisturePercent,
      qualityPass: true,
      netQuintals: body.netQuintals,
      mspPaisePerQuintal: season.mspPaisePerQuintal,
      amountPaise: value,
      jFormNumber,
      jFormIssuedAt,
      paymentStage: "J_FORM_ISSUED",
      slaDueAt: slaDueAt(jFormIssuedAt),
      slaBreached: false,
    },
  });

  await prisma.booking.update({
    where: { id: booking.id },
    data: { status: "COMPLETED", completedAt: jFormIssuedAt },
  });

  await notify({
    farmerId: booking.farmerId,
    template: "JFORM_ISSUED",
    vars: {
      jForm: jFormNumber,
      quantity: body.netQuintals,
      amount: formatPaise(value),
      slaHours: 72,
    },
  });

  res.status(201).json({
    lot: { ...lot, amountPaise: lot.amountPaise?.toString() ?? null },
    qualityPass: true,
    reslotted: false,
  });
});

const stageSchema = z.object({
  stage: z.enum(["LIFTED", "AGENCY_ACKNOWLEDGED", "SENT_FOR_PAYMENT", "CREDITED"]),
});

/**
 * Records a payment milestone.
 *
 * The body names the milestone that happened; the **stage is then derived** from
 * the resulting timestamps rather than taken from the request, so the tracker
 * cannot be told something the timestamps do not support.
 */
centreRouter.patch("/lots/:id/stage", officerOnly, async (req, res) => {
  const id = String(req.params["id"]);
  const body = parseBody(stageSchema, req);

  const lot = await prisma.lot.findUnique({ where: { id } });
  if (!lot) throw notFound("No such lot.");
  await assertCentreAccess(sessionOf(req), lot.centreId);

  if (!lot.jFormIssuedAt) {
    throw new HttpError(409, "slot_gone", "This lot has no J-form yet, so the payment clock has not started.");
  }

  const now = new Date();
  const timestampPatch =
    body.stage === "LIFTED" ? { liftedAt: now }
    : body.stage === "AGENCY_ACKNOWLEDGED" ? { agencyAckAt: now }
    : body.stage === "SENT_FOR_PAYMENT" ? { pfmsBatchAt: now }
    : { creditedAt: now };

  const merged = { ...lot, ...timestampPatch };
  const stage = deriveStage(merged);
  const breached = isBreached(merged, now);

  const updated = await prisma.lot.update({
    where: { id },
    data: { ...timestampPatch, paymentStage: stage, slaBreached: breached },
  });

  if (stage === "CREDITED" && updated.amountPaise) {
    await notify({
      farmerId: updated.farmerId,
      template: "PAYMENT_CREDITED",
      vars: { amount: formatPaise(updated.amountPaise), jForm: updated.jFormNumber ?? "—" },
    });
  }

  const status = paymentStatus(updated, now);

  emitPaymentStage({
    lotId: updated.id,
    farmerId: updated.farmerId,
    stage: status.stage,
    slaBreached: status.breached,
    at: now.toISOString(),
  });

  // Still overdue after the update: the admin board needs the new owner, since
  // moving a stage moves the accountable office with it.
  if (status.breached) {
    emitAdminEscalation({
      lotId: updated.id,
      centreId: updated.centreId,
      stage: status.stage,
      owner: status.owner,
      hoursOverdue: status.hoursOverdue,
      at: now.toISOString(),
    });
  }

  res.json({
    lot: { ...updated, amountPaise: updated.amountPaise?.toString() ?? null },
    ...status,
  });
});
