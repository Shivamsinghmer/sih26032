/**
 * Seeds one district, mid-season.
 *
 * Shaped so the two demonstrations in docs/FLOW.md work the moment the seed
 * finishes, rather than needing ten minutes of clicking first:
 *
 *   Loop A — capacity drop before travel. Sangrur's day+1 is published and
 *     booked to roughly 85% of its offered capacity. Republish it with fewer
 *     trucks (or fewer bags) and the overflow re-slots while those farmers are
 *     still at home. This only demonstrates anything if the day is genuinely
 *     near-full, which is why the district is seeded at realistic scale — a
 *     mandi day is thirty-odd trolleys, not four.
 *
 *   Loop B — moisture failure. Bookings sit in ARRIVED at Barnala with the
 *     season's 17% paddy limit in place, ready for a 20% reading.
 *
 * The payment ladder hangs off its own **historical** bookings on past dates,
 * not off today's queue: a booking whose slot is today cannot have a J-form
 * from eight days ago, and seeding that contradiction makes every screen that
 * joins the two look broken.
 */

import { PrismaClient, type Crop, type Locale } from "@prisma/client";
import {
  computeCapacity,
  allocate,
  deriveStage,
  slaDueAt,
  isBreached,
  amountPaise,
  PAYMENT_SLA_HOURS,
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

/** Punjab paddy runs roughly this per acre, which keeps declared quantities plausible. */
const QUINTALS_PER_ACRE = 21;

function plausibleQuantity(acres: number): number {
  return Math.round(acres * QUINTALS_PER_ACRE * 10) / 10;
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
  // Ten named farmers with deliberately mixed verification states, then enough
  // generated ones to fill a real mandi day. A demo that shows only the happy
  // path proves nothing about the gates.
  const namedFarmers = [
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

  const givenNames = [
    "Gurpreet", "Sukhwinder", "Baljit", "Karamjit", "Tarsem", "Darshan", "Joginder",
    "Rachhpal", "Surjit", "Malkiat", "Hardev", "Avtar", "Charanjit", "Bhupinder",
    "Jaswant", "Mohinder", "Ranjit", "Sarabjit",
  ];
  const surnames = ["Singh", "Kaur", "Sidhu", "Brar", "Dhillon", "Gill", "Mann"];
  const villages = [
    "Longowal", "Bhawanigarh", "Lehragaga", "Moonak", "Sunam", "Dirba", "Sherpur",
    "Ahmedgarh", "Khanauri", "Cheema", "Badrukhan", "Kauhrian",
  ];

  const GENERATED_COUNT = 35;
  const farmerSpecs: {
    name: string; village: string; acres: number; aadhaar: boolean; land: boolean; locale: Locale;
  }[] = namedFarmers.map((f) => ({ ...f, locale: f.locale as Locale }));

  for (let i = 0; i < GENERATED_COUNT; i++) {
    // Deterministic rather than random, so two runs of the seed produce the
    // same district and a bug is reproducible.
    const given = givenNames[i % givenNames.length]!;
    const surname = surnames[(i * 3) % surnames.length]!;
    farmerSpecs.push({
      name: `${given} ${surname}`,
      village: villages[(i * 5) % villages.length]!,
      acres: Math.round((1.5 + ((i * 7) % 65) / 10) * 10) / 10, // 1.5 – 8.0
      aadhaar: true,
      land: true,
      locale: i % 3 === 0 ? "hi" : "pa",
    });
  }

  const farmers = [];
  for (const [i, spec] of farmerSpecs.entries()) {
    farmers.push(
      await prisma.farmer.create({
        data: {
          clerkId: `seed_farmer_${i + 1}`,
          phone: `+9198${String(11000000 + i).padStart(8, "0")}`,
          name: spec.name,
          village: spec.village,
          district: "Sangrur",
          state: "Punjab",
          landAcres: spec.acres,
          landVerified: spec.land,
          aadhaarVerified: spec.aadhaar,
          aadhaarLast4: spec.aadhaar ? String(7000 + i).slice(-4) : null,
          aadhaarRefId: spec.aadhaar ? `REF${900000 + i}` : null,
          aadhaarVerifiedAt: spec.aadhaar ? hoursAgo(24 * ((i % 20) + 2)) : null,
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
  // Tomorrow is the Loop A day. Bardana binds at 2250 qtl, which a realistic
  // number of trolleys can actually fill.
  const sgrTomorrow = await publishDay(
    sangrur,
    1,
    { bardanaBags: 4500, labourGangs: 8, trucksAssigned: 7, weighbridgeHours: 9, openingBacklogQuintals: 250 },
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

  /** Gate pass codes are unique per centre and scanned at entry. */
  const passCounter: Record<string, number> = {};
  function gatePass(code: string): string {
    passCounter[code] = (passCounter[code] ?? 0) + 1;
    return `${code}-${String(passCounter[code]).padStart(4, "0")}`;
  }

  // Today at Sangrur: a day already part-way through, so the queue board has a
  // served history for the observed-rate ETA to work from.
  const todayStatuses = ["COMPLETED", "COMPLETED", "COMPLETED", "IN_PROGRESS", "ARRIVED", "BOOKED", "BOOKED"] as const;
  const sgrTodayBookings = [];
  let todayQuintals = 0;

  for (const [i, status] of todayStatuses.entries()) {
    const farmer = farmers[i]!;
    const qty = plausibleQuantity(farmer.landAcres ?? 3);
    sgrTodayBookings.push(
      await prisma.booking.create({
        data: {
          farmerId: farmer.id,
          centreId: sangrur.id,
          capacityDayId: sgrToday.row.id,
          slotStart: at(0, 9 + i, 0),
          slotEnd: at(0, 9 + i, 45),
          crop: "PADDY" as Crop,
          quantityQuintals: qty,
          status,
          tokenNumber: i + 1,
          gatePassCode: gatePass(sangrur.code),
          seniorityAt: hoursAgo(72 - i * 2),
          arrivedAt: status === "BOOKED" ? null : at(0, 9 + i, 5),
          startedAt: status === "COMPLETED" || status === "IN_PROGRESS" ? at(0, 9 + i, 15) : null,
          completedAt: status === "COMPLETED" ? at(0, 9 + i, 40) : null,
        },
      }),
    );
    todayQuintals += qty;
  }
  const sgrTodayOffered = allocate(sgrToday.result.sellableQuintals).offeredQuintals;
  console.log(
    `  SGR today      ${sgrTodayBookings.length} bookings, ${Math.round(todayQuintals)} of ${sgrTodayOffered} qtl offered` +
      ` (3 completed, 1 in progress)`,
  );

  // Tomorrow at Sangrur — the Loop A day. Booked to roughly 85% of offered, so
  // a modest capacity drop pushes real farmers into overflow. These are the
  // people who must learn at home rather than at the gate.
  const sgrTomorrowOffered = allocate(sgrTomorrow.result.sellableQuintals).offeredQuintals;
  const targetFill = sgrTomorrowOffered * 0.85;

  const tomorrowBookings = [];
  let tomorrowQuintals = 0;
  let tokenNo = 0;

  // Draw from the generated population so the named farmers stay free for the
  // narrative parts of the demo.
  for (let i = 10; i < farmers.length; i++) {
    const farmer = farmers[i]!;
    const qty = plausibleQuantity(farmer.landAcres ?? 3);
    if (tomorrowQuintals + qty > targetFill) continue;

    tokenNo += 1;
    // 18-minute slots from the 9am open, which is roughly what two weighbridges
    // sustain across a nine-hour day.
    const minutesFromOpen = (tokenNo - 1) * 18;
    tomorrowBookings.push(
      await prisma.booking.create({
        data: {
          farmerId: farmer.id,
          centreId: sangrur.id,
          capacityDayId: sgrTomorrow.row.id,
          slotStart: at(1, 9 + Math.floor(minutesFromOpen / 60), minutesFromOpen % 60),
          slotEnd: at(1, 9 + Math.floor((minutesFromOpen + 18) / 60), (minutesFromOpen + 18) % 60),
          crop: "PADDY" as Crop,
          quantityQuintals: qty,
          status: "BOOKED",
          tokenNumber: tokenNo,
          gatePassCode: gatePass(sangrur.code),
          seniorityAt: hoursAgo(60 - (tokenNo % 40)),
        },
      }),
    );
    tomorrowQuintals += qty;
  }

  // One farmer already bumped once, carrying seniority from the slot they lost.
  // The next re-slot must not punish them again — this is the row that proves
  // reslotOverflow orders by seniorityAt rather than createdAt.
  tokenNo += 1;
  await prisma.booking.create({
    data: {
      farmerId: farmers[8]!.id,
      centreId: sangrur.id,
      capacityDayId: sgrTomorrow.row.id,
      slotStart: at(1, 16, 0),
      slotEnd: at(1, 16, 30),
      crop: "PADDY" as Crop,
      quantityQuintals: plausibleQuantity(farmers[8]!.landAcres ?? 1.2),
      status: "BOOKED",
      tokenNumber: tokenNo,
      gatePassCode: gatePass(sangrur.code),
      // Seniority from four days ago, though the booking itself is new.
      seniorityAt: hoursAgo(96),
      reslotCount: 1,
      reslotReason:
        "Gunny bag shortage at Sangrur Grain Market. Your slot has been moved — please do not travel today.",
    },
  });

  const fillPercent = Math.round((tomorrowQuintals / sgrTomorrowOffered) * 100);
  console.log(
    `  SGR tomorrow   ${tomorrowBookings.length + 1} bookings, ${Math.round(tomorrowQuintals)} of ${sgrTomorrowOffered} qtl offered (${fillPercent}%)`,
  );
  console.log("                 Loop A: republish with trucksAssigned=0 to force overflow");
  console.log("                 includes 1 farmer already re-slotted once (seniority preserved)");

  // Barnala, arrived and waiting — Loop B needs a token at the quality gate.
  const bnlBookings = [];
  for (const [i, farmerIndex] of [6, 7].entries()) {
    const farmer = farmers[farmerIndex]!;
    bnlBookings.push(
      await prisma.booking.create({
        data: {
          farmerId: farmer.id,
          centreId: barnala.id,
          capacityDayId: bnlToday.row.id,
          slotStart: at(0, 10 + i, 0),
          slotEnd: at(0, 10 + i, 45),
          crop: "PADDY" as Crop,
          quantityQuintals: plausibleQuantity(farmer.landAcres ?? 2),
          status: "ARRIVED",
          tokenNumber: i + 1,
          gatePassCode: gatePass(barnala.code),
          seniorityAt: hoursAgo(30 - i),
          arrivedAt: at(0, 10 + i, 10),
        },
      }),
    );
  }
  console.log(`  BNL today      ${bnlBookings.length} arrived (Loop B: record 20% moisture)`);

  // --- Payment ladder -----------------------------------------------------
  // On its own historical bookings. A lot's J-form timestamp has to sit inside
  // the day its booking was served, or every screen that joins the two shows an
  // impossible timeline.
  //
  // Only the two entries labelled BREACHED are past the 72-hour norm. The rest
  // are recent enough to still be inside it — otherwise the escalation screen
  // fills with lots that are progressing perfectly well, and the two that
  // genuinely need chasing are lost in the noise.
  console.log("\nlots");

  const ladder = [
    { label: "credited, paid inside the norm", jForm: 200, lifted: 190, ack: 180, pfms: 170, credited: 160 },
    { label: "sent for payment", jForm: 60, lifted: 50, ack: 40, pfms: 20, credited: null },
    { label: "agency acknowledged", jForm: 50, lifted: 42, ack: 30, pfms: null, credited: null },
    { label: "stuck at agency", jForm: 96, lifted: 88, ack: null, pfms: null, credited: null },
    { label: "truck never came", jForm: 90, lifted: null, ack: null, pfms: null, credited: null },
    { label: "just issued", jForm: 10, lifted: null, ack: null, pfms: null, credited: null },
  ] as const;

  for (const [i, step] of ladder.entries()) {
    // A distinct farmer per historical lot, drawn from the tail of the
    // population so nobody ends up with a J-form that overlaps a live booking.
    const farmer = farmers[farmers.length - 1 - i]!;
    const netQuintals = plausibleQuantity(farmer.landAcres ?? 3);

    const timestamps = {
      jFormIssuedAt: hoursAgo(step.jForm),
      liftedAt: step.lifted === null ? null : hoursAgo(step.lifted),
      agencyAckAt: step.ack === null ? null : hoursAgo(step.ack),
      pfmsBatchAt: step.pfms === null ? null : hoursAgo(step.pfms),
      creditedAt: step.credited === null ? null : hoursAgo(step.credited),
    };

    // The historical booking this lot came from: served on the day the J-form
    // was cut, which is what makes the farmer's payment history coherent.
    const historicalBooking = await prisma.booking.create({
      data: {
        farmerId: farmer.id,
        centreId: sangrur.id,
        slotStart: hoursAgo(step.jForm + 3),
        slotEnd: hoursAgo(step.jForm + 2),
        crop: "PADDY" as Crop,
        quantityQuintals: netQuintals,
        status: "COMPLETED",
        tokenNumber: i + 1,
        gatePassCode: gatePass(sangrur.code),
        seniorityAt: hoursAgo(step.jForm + 30),
        arrivedAt: hoursAgo(step.jForm + 3),
        startedAt: hoursAgo(step.jForm + 2),
        completedAt: hoursAgo(step.jForm),
      },
    });

    // Stage and breach are DERIVED, never typed in, so the seeded rows agree
    // with what the API will compute from the same timestamps.
    const stage = deriveStage(timestamps);
    const breached = isBreached(timestamps);

    await prisma.lot.create({
      data: {
        bookingId: historicalBooking.id,
        farmerId: farmer.id,
        centreId: sangrur.id,
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

    console.log(
      `  ${stage.padEnd(22)} ${breached ? "BREACHED" : "within SLA"}  ${step.label}`,
    );
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
      reslotReason:
        "Moisture 20.4% exceeds the 17% limit for paddy. Re-dry and return — a new slot has been issued.",
    },
  });
  console.log("  AWAITING_JFORM         rejected    moisture 20.4% > 17% limit");

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
        body: "Gunny bag shortage at Sangrur Grain Market. Your slot has moved to tomorrow 4:00 PM. Please do not travel today.",
      },
      {
        farmerId: farmers[7]!.id, channel: "SMS", template: "MOISTURE_FAIL", locale: "pa",
        toPhone: farmers[7]!.phone, status: "SENT", sentAt: hoursAgo(2),
        body: "Moisture 20.4% is above the 17% limit. Please re-dry. Your new slot is in 3 days.",
      },
      {
        farmerId: farmers[farmers.length - 1]!.id, channel: "SMS", template: "PAYMENT_CREDITED", locale: "pa",
        toPhone: farmers[farmers.length - 1]!.phone, status: "SENT", sentAt: hoursAgo(160),
        body: "Payment for J-form JF/SGR/2026/1000 has been credited to your account.",
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
      `${lots} lots (${breached} breached, ${PAYMENT_SLA_HOURS}h norm)\n`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
