/**
 * Seeds one district, mid-season.
 *
 * Shaped so the two demonstrations in docs/FLOW.md work the moment the seed
 * finishes, rather than needing ten minutes of clicking first:
 *
 *   Loop A — capacity drop before travel. Sangrur is published and filled close
 *     to its offered capacity, and its binding constraint is BARDANA. Republish
 *     it with fewer trucks or fewer bags and the overflow re-slots while those
 *     farmers are still at home.
 *
 *   Loop B — moisture failure. Bookings sit in ARRIVED at Barnala with the
 *     season's 17% paddy limit in place, ready for a 20% reading.
 *
 * It also seeds a payment ladder: one lot at every stage, including one already
 * past the 72-hour norm so the admin escalation screen has something real in it.
 */

import { PrismaClient, type Crop } from "@prisma/client";
import {
  computeCapacity,
  allocate,
  deriveStage,
  slaDueAt,
  isBreached,
  amountPaise,
} from "@mandi/shared";

const prisma = new PrismaClient();

/** Midnight UTC for a day offset from today, matching the @db.Date columns. */
function day(offset: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

function at(dayOffset: number, hour: number, minute = 0): Date {
  const d = day(dayOffset);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

/** Deterministic, human-readable gate pass. Unique per booking. */
function gatePass(centreCode: string, n: number): string {
  return `${centreCode}-${String(n).padStart(4, "0")}`;
}

async function main(): Promise<void> {
  console.log("seeding district: Sangrur, Punjab (KMS 2026-27)\n");

  // Order matters: children first, because the FK cascades only fire downward.
  await prisma.notification.deleteMany();
  await prisma.lot.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.capacityDay.deleteMany();
  await prisma.delegation.deleteMany();
  await prisma.aarhtiya.deleteMany();
  await prisma.officer.deleteMany();
  await prisma.farmer.deleteMany();
  await prisma.centre.deleteMany();
  await prisma.seasonConfig.deleteMany();

  // --- Season -------------------------------------------------------------
  // MSP is notified per season on CACP's recommendation, so it is configuration
  // a district admin edits. The J-form route reads it at the moment of issue.
  const PADDY_MSP_PAISE = 230000n; // Rs 2,300.00 per quintal
  const WHEAT_MSP_PAISE = 242500n; // Rs 2,425.00 per quintal

  await prisma.seasonConfig.createMany({
    data: [
      {
        season: "KMS 2026-27",
        crop: "PADDY",
        mspPaisePerQuintal: PADDY_MSP_PAISE,
        moistureLimitPercent: 17, // the FCI cap for paddy
        state: "Punjab",
        active: true,
        startsOn: day(-45),
        endsOn: day(45),
      },
      {
        season: "RMS 2026-27",
        crop: "WHEAT",
        mspPaisePerQuintal: WHEAT_MSP_PAISE,
        moistureLimitPercent: 12,
        state: "Punjab",
        active: false,
        startsOn: day(150),
        endsOn: day(240),
      },
    ],
  });

  // --- Centres ------------------------------------------------------------
  // Fixed physical characteristics only; anything daily lives in CapacityDay.
  const sangrur = await prisma.centre.create({
    data: {
      name: "Sangrur Grain Market",
      code: "SGR",
      village: "Sangrur",
      district: "Sangrur",
      state: "Punjab",
      weighbridgeCount: 2,
      openHour: 9,
      closeHour: 18,
      yardCapacityQuintals: 2000,
      latitude: 30.2458,
      longitude: 75.8421,
    },
  });

  const barnala = await prisma.centre.create({
    data: {
      name: "Barnala Procurement Centre",
      code: "BNL",
      village: "Barnala",
      district: "Sangrur",
      state: "Punjab",
      weighbridgeCount: 1,
      openHour: 9,
      closeHour: 18,
      yardCapacityQuintals: 1200,
      latitude: 30.3745,
      longitude: 75.5487,
    },
  });

  const dhuri = await prisma.centre.create({
    data: {
      name: "Dhuri Mandi",
      code: "DHR",
      village: "Dhuri",
      district: "Sangrur",
      state: "Punjab",
      weighbridgeCount: 1,
      openHour: 9,
      closeHour: 17,
      yardCapacityQuintals: 900,
      latitude: 30.3682,
      longitude: 75.8674,
    },
  });

  console.log(`centres        ${[sangrur, barnala, dhuri].map((c) => c.code).join(", ")}`);

  // --- Officers -----------------------------------------------------------
  // clerkId values are placeholders until a real account is promoted in the
  // Clerk dashboard. Neither officer nor admin is self-assignable.
  await prisma.officer.createMany({
    data: [
      { clerkId: "seed_officer_sgr", phone: "+919800000001", name: "Harpreet Singh", role: "officer", centreId: sangrur.id },
      { clerkId: "seed_officer_bnl", phone: "+919800000002", name: "Rajwinder Kaur", role: "officer", centreId: barnala.id },
      { clerkId: "seed_officer_dhr", phone: "+919800000003", name: "Manjit Singh", role: "officer", centreId: dhuri.id },
      // District admin, deliberately not tied to one centre.
      { clerkId: "seed_admin_sgr", phone: "+919800000009", name: "Dr. Neelam Sharma", role: "admin", centreId: null },
    ],
  });

  const aarhtiya = await prisma.aarhtiya.create({
    data: {
      clerkId: "seed_aarhtiya_1",
      phone: "+919800000021",
      name: "Gurdial Singh & Sons",
      licenceNo: "PB-SGR-0142",
      centreId: sangrur.id,
    },
  });

  // --- Farmers ------------------------------------------------------------
  // Deliberately mixed verification states: a demo that shows only the happy
  // path proves nothing about the gates.
  const farmerSpecs = [
    { name: "Balwinder Singh", village: "Longowal", acres: 4.5, aadhaar: true, land: true, locale: "pa" },
    { name: "Sukhdev Kaur", village: "Bhawanigarh", acres: 2.5, aadhaar: true, land: true, locale: "pa" },
    { name: "Jagtar Singh", village: "Lehragaga", acres: 7.0, aadhaar: true, land: true, locale: "pa" },
    { name: "Ramesh Kumar", village: "Moonak", acres: 1.8, aadhaar: true, land: true, locale: "hi" },
    { name: "Paramjit Kaur", village: "Sunam", acres: 3.2, aadhaar: true, land: true, locale: "pa" },
    { name: "Harbans Lal", village: "Dirba", acres: 5.5, aadhaar: true, land: true, locale: "hi" },
    { name: "Amrik Singh", village: "Sherpur", acres: 2.0, aadhaar: true, land: true, locale: "pa" },
    { name: "Kuldeep Singh", village: "Ahmedgarh", acres: 6.2, aadhaar: true, land: true, locale: "pa" },
    // Verified identity, unverified land: entitled to nothing until the record
    // is matched. This is where the tenant-cultivator exclusion risk lives.
    { name: "Nirmal Singh", village: "Malerkotla", acres: 1.2, aadhaar: true, land: false, locale: "pa" },
    // Signed up, never finished the Aadhaar gate — blocked from every /farmer route.
    { name: "Satpal Singh", village: "Khanauri", acres: 2.8, aadhaar: false, land: false, locale: "hi" },
  ] as const;

  const farmers = [];
  for (const [i, spec] of farmerSpecs.entries()) {
    farmers.push(
      await prisma.farmer.create({
        data: {
          clerkId: `seed_farmer_${i + 1}`,
          phone: `+9198111000${String(i + 10).padStart(2, "0")}`,
          name: spec.name,
          village: spec.village,
          district: "Sangrur",
          state: "Punjab",
          landAcres: spec.acres,
          landVerified: spec.land,
          aadhaarVerified: spec.aadhaar,
          aadhaarLast4: spec.aadhaar ? String(7000 + i) : null,
          aadhaarRefId: spec.aadhaar ? `REF${900000 + i}` : null,
          aadhaarVerifiedAt: spec.aadhaar ? hoursAgo(24 * (i + 2)) : null,
          verificationMethod: spec.aadhaar ? "AADHAAR_SECURE_QR" : null,
          preferredLocale: spec.locale,
        },
      }),
    );
  }
  console.log(`farmers        ${farmers.length} (1 unverified, 1 land-unverified)`);

  // The commission agent as a first-class actor with an explicit, revocable grant.
  await prisma.delegation.create({
    data: { farmerId: farmers[3]!.id, aarhtiyaId: aarhtiya.id },
  });

  // --- Capacity -----------------------------------------------------------
  // The engine's own output is written here, so the seeded numbers and the
  // running system agree rather than drifting apart.
  async function publishDay(
    centre: { id: string; code: string; weighbridgeCount: number; yardCapacityQuintals: number },
    dayOffset: number,
    input: {
      bardanaBags: number;
      labourGangs: number;
      trucksAssigned: number;
      weighbridgeHours: number;
      openingBacklogQuintals: number;
    },
    status: "DRAFT" | "PUBLISHED",
  ) {
    const result = computeCapacity({
      ...input,
      weighbridgeCount: centre.weighbridgeCount,
      yardCapacityQuintals: centre.yardCapacityQuintals,
    });

    const row = await prisma.capacityDay.create({
      data: {
        centreId: centre.id,
        date: day(dayOffset),
        ...input,
        computedQuintals: result.sellableQuintals,
        bindingConstraint: result.bindingConstraint,
        breakdown: result.breakdown as unknown as object,
        approvedQuintals: result.sellableQuintals,
        status,
        publishedAt: status === "PUBLISHED" ? hoursAgo(12) : null,
      },
    });

    console.log(
      `  ${centre.code} ${status === "PUBLISHED" ? "published" : "draft    "} d${dayOffset >= 0 ? "+" : ""}${dayOffset}  ` +
        `${String(result.sellableQuintals).padStart(6)} qtl  binding=${result.bindingConstraint}`,
    );
    return { row, result };
  }

  console.log("\ncapacity");

  // Today at Sangrur: bardana is short, which is the constraint worth demoing.
  const sgrToday = await publishDay(
    sangrur,
    0,
    { bardanaBags: 3000, labourGangs: 8, trucksAssigned: 6, weighbridgeHours: 9, openingBacklogQuintals: 350 },
    "PUBLISHED",
  );
  const sgrTomorrow = await publishDay(
    sangrur,
    1,
    { bardanaBags: 7000, labourGangs: 9, trucksAssigned: 7, weighbridgeHours: 9, openingBacklogQuintals: 200 },
    "PUBLISHED",
  );
  const bnlToday = await publishDay(
    barnala,
    0,
    { bardanaBags: 4000, labourGangs: 5, trucksAssigned: 4, weighbridgeHours: 8, openingBacklogQuintals: 180 },
    "PUBLISHED",
  );
  // Dhuri has not published tomorrow yet — a draft is invisible to farmers, and
  // the admin "who has published today" view should show a real gap.
  await publishDay(
    dhuri,
    1,
    { bardanaBags: 2000, labourGangs: 3, trucksAssigned: 2, weighbridgeHours: 8, openingBacklogQuintals: 500 },
    "DRAFT",
  );

  // --- Bookings -----------------------------------------------------------
  console.log("\nbookings");

  const sgrOffered = allocate(sgrToday.result.sellableQuintals).offeredQuintals;
  let pass = 0;

  // Today at Sangrur, filled to roughly 85% of offered so a modest capacity drop
  // pushes real farmers into overflow — Loop A, without needing a huge cut.
  const todayQuantities = [45, 60, 38, 52, 70];
  let booked = 0;
  const sgrBookings = [];
  for (const [i, qty] of todayQuantities.entries()) {
    const farmer = farmers[i]!;
    sgrBookings.push(
      await prisma.booking.create({
        data: {
          farmerId: farmer.id,
          centreId: sangrur.id,
          capacityDayId: sgrToday.row.id,
          slotStart: at(0, 9 + i, 0),
          slotEnd: at(0, 10 + i, 0),
          crop: "PADDY" as Crop,
          quantityQuintals: qty,
          status: i < 2 ? "COMPLETED" : i < 4 ? "ARRIVED" : "BOOKED",
          tokenNumber: i + 1,
          gatePassCode: gatePass(sangrur.code, ++pass),
          seniorityAt: hoursAgo(72 - i * 2),
          arrivedAt: i < 4 ? at(0, 9 + i, 5) : null,
          completedAt: i < 2 ? at(0, 10 + i, 30) : null,
        },
      }),
    );
    booked += qty;
  }
  console.log(`  SGR today      ${sgrBookings.length} bookings, ${booked} of ${sgrOffered} qtl offered`);

  // Tomorrow at Sangrur — these are the farmers who would be re-slotted, and
  // crucially they are still at home.
  const tomorrowBookings = [];
  for (const [i, qty] of [55, 48, 62, 40].entries()) {
    const farmer = farmers[i + 4]!;
    tomorrowBookings.push(
      await prisma.booking.create({
        data: {
          farmerId: farmer.id,
          centreId: sangrur.id,
          capacityDayId: sgrTomorrow.row.id,
          slotStart: at(1, 9 + i, 0),
          slotEnd: at(1, 10 + i, 0),
          crop: "PADDY" as Crop,
          quantityQuintals: qty,
          status: "BOOKED",
          tokenNumber: i + 1,
          gatePassCode: gatePass(sangrur.code, ++pass),
          seniorityAt: hoursAgo(48 - i * 3),
        },
      }),
    );
  }
  console.log(`  SGR tomorrow   ${tomorrowBookings.length} bookings (Loop A: republish with fewer trucks)`);

  // One farmer already bumped once, carrying seniority from the slot they lost.
  // The next re-slot must not punish them again.
  await prisma.booking.create({
    data: {
      farmerId: farmers[8]!.id,
      centreId: sangrur.id,
      capacityDayId: sgrTomorrow.row.id,
      slotStart: at(1, 14, 0),
      slotEnd: at(1, 15, 0),
      crop: "PADDY" as Crop,
      quantityQuintals: 30,
      status: "BOOKED",
      tokenNumber: 5,
      gatePassCode: gatePass(sangrur.code, ++pass),
      // Seniority from three days ago, though the booking itself is new.
      seniorityAt: hoursAgo(96),
      reslotCount: 1,
      reslotReason: "Gunny bag shortage at Sangrur Grain Market. Your slot has been moved — please do not travel today.",
    },
  });
  console.log("  SGR tomorrow   +1 already re-slotted once (seniority preserved)");

  // Barnala, arrived and waiting — Loop B needs a token at the quality gate.
  let bnlPass = 0;
  const bnlBookings = [];
  for (const [i, qty] of [35, 44].entries()) {
    bnlBookings.push(
      await prisma.booking.create({
        data: {
          farmerId: farmers[i + 6]!.id,
          centreId: barnala.id,
          capacityDayId: bnlToday.row.id,
          slotStart: at(0, 10 + i, 0),
          slotEnd: at(0, 11 + i, 0),
          crop: "PADDY" as Crop,
          quantityQuintals: qty,
          status: "ARRIVED",
          tokenNumber: i + 1,
          gatePassCode: gatePass(barnala.code, ++bnlPass),
          seniorityAt: hoursAgo(30 - i),
          arrivedAt: at(0, 10 + i, 10),
        },
      }),
    );
  }
  console.log(`  BNL today      ${bnlBookings.length} arrived (Loop B: record 20% moisture)`);

  // --- Lots ---------------------------------------------------------------
  // A payment ladder: one lot at each stage, so the tracker and the escalation
  // screen both have real data. Every stage is DERIVED from these timestamps.
  console.log("\nlots");

  const ladder = [
    { label: "credited", jForm: 200, lifted: 190, ack: 180, pfms: 170, credited: 160 },
    { label: "sent for payment", jForm: 120, lifted: 110, ack: 100, pfms: 90, credited: null },
    { label: "agency acknowledged", jForm: 100, lifted: 92, ack: 80, pfms: null, credited: null },
    // Past 72h and stuck at lifting — the escalation the admin panel exists for.
    { label: "BREACHED, awaiting agency", jForm: 96, lifted: 88, ack: null, pfms: null, credited: null },
    // J-form cut, truck never came. Also breached, owned by transport.
    { label: "BREACHED, awaiting lift", jForm: 90, lifted: null, ack: null, pfms: null, credited: null },
    { label: "within SLA", jForm: 10, lifted: null, ack: null, pfms: null, credited: null },
  ] as const;

  for (const [i, step] of ladder.entries()) {
    const booking = sgrBookings[i % sgrBookings.length]!;
    const netQuintals = booking.quantityQuintals;

    const timestamps = {
      jFormIssuedAt: hoursAgo(step.jForm),
      liftedAt: step.lifted === null ? null : hoursAgo(step.lifted),
      agencyAckAt: step.ack === null ? null : hoursAgo(step.ack),
      pfmsBatchAt: step.pfms === null ? null : hoursAgo(step.pfms),
      creditedAt: step.credited === null ? null : hoursAgo(step.credited),
    };

    const stage = deriveStage(timestamps);
    const breached = isBreached(timestamps);

    // One lot per booking — the relation is unique — so later ladder entries
    // reuse earlier bookings only if there are enough. Guard against collisions.
    const exists = await prisma.lot.findUnique({ where: { bookingId: booking.id } });
    if (exists) continue;

    await prisma.lot.create({
      data: {
        bookingId: booking.id,
        farmerId: booking.farmerId,
        centreId: booking.centreId,
        moisturePercent: 15.5 + i * 0.2,
        qualityPass: true,
        netQuintals,
        mspPaisePerQuintal: PADDY_MSP_PAISE,
        amountPaise: amountPaise(netQuintals, PADDY_MSP_PAISE),
        jFormNumber: `JF/SGR/2026/${String(1000 + i)}`,
        ...timestamps,
        paymentStage: stage,
        slaDueAt: slaDueAt(timestamps.jFormIssuedAt),
        slaBreached: breached,
      },
    });

    console.log(`  ${stage.padEnd(22)} ${breached ? "BREACHED" : "        "}  ${step.label}`);
  }

  // A rejected lot: moisture above the 17% limit, the booking re-slotted for
  // re-dry, and the farmer told the new date before leaving the yard.
  const rejectedBooking = bnlBookings[1]!;
  await prisma.lot.create({
    data: {
      bookingId: rejectedBooking.id,
      farmerId: rejectedBooking.farmerId,
      centreId: rejectedBooking.centreId,
      moisturePercent: 20.4,
      qualityPass: false,
      rejectionReason: "Moisture 20.4% exceeds the 17% limit for paddy. Re-dry and return.",
      paymentStage: "AWAITING_JFORM",
    },
  });
  await prisma.booking.update({
    where: { id: rejectedBooking.id },
    data: {
      status: "RESLOTTED",
      reslotCount: 1,
      reslotReason: "Moisture 20.4% exceeds the 17% limit for paddy. Re-dry and return — a new slot has been issued.",
    },
  });
  console.log("  AWAITING_JFORM         rejected on moisture (20.4% > 17%)");

  // --- Notifications ------------------------------------------------------
  // Delivery is stubbed; the records are real, and `template` records which
  // DLT-registered body was used.
  await prisma.notification.createMany({
    data: [
      {
        farmerId: farmers[0]!.id, channel: "SMS", template: "SLOT_CONFIRMED", locale: "pa",
        toPhone: farmers[0]!.phone, status: "SENT", sentAt: hoursAgo(70),
        body: "Your slot at Sangrur Grain Market is confirmed for today 9:00 AM. Gate pass SGR-0001.",
      },
      {
        farmerId: farmers[8]!.id, channel: "SMS", template: "SLOT_RESLOTTED", locale: "pa",
        toPhone: farmers[8]!.phone, status: "SENT", sentAt: hoursAgo(20),
        body: "Gunny bag shortage at Sangrur Grain Market. Your slot has moved to tomorrow 2:00 PM. Please do not travel today.",
      },
      {
        farmerId: farmers[7]!.id, channel: "SMS", template: "MOISTURE_FAIL", locale: "pa",
        toPhone: farmers[7]!.phone, status: "SENT", sentAt: hoursAgo(2),
        body: "Moisture 20.4% is above the 17% limit. Please re-dry. Your new slot is in 3 days.",
      },
      {
        farmerId: farmers[0]!.id, channel: "SMS", template: "PAYMENT_CREDITED", locale: "pa",
        toPhone: farmers[0]!.phone, status: "SENT", sentAt: hoursAgo(160),
        body: "Rs 1,03,500 has been credited to your account for J-form JF/SGR/2026/1000.",
      },
    ],
  });

  // --- Summary ------------------------------------------------------------
  const [centres, farmerCount, bookings, lots, breached] = await Promise.all([
    prisma.centre.count(),
    prisma.farmer.count(),
    prisma.booking.count(),
    prisma.lot.count(),
    prisma.lot.count({ where: { slaBreached: true } }),
  ]);

  console.log(
    `\nseeded: ${centres} centres, ${farmerCount} farmers, ${bookings} bookings, ` +
      `${lots} lots (${breached} breached)\n`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
