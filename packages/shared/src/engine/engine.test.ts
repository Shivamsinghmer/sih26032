import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeCapacity, OPS, bookableQuintals } from "./capacity-engine.js";
import {
  allocate,
  reslotOverflow,
  estimateWaitMinutes,
  ALLOCATION_DEFAULTS,
  type ReslotCandidate,
} from "./slot-allocator.js";
import {
  deriveStage,
  ownerOf,
  slaDueAt,
  isBreached,
  hoursOverdue,
  amountPaise,
  type PaymentTimestamps,
} from "./payment-stages.js";

/** A centre where no single resource is obviously tightest, so each test can starve exactly one. */
const balanced = {
  bardanaBags: 6000, // 3000 qtl
  labourGangs: 9, // 3150 qtl
  trucksAssigned: 8, // yard: 2000 - 400 + 2240 = 3840
  weighbridgeHours: 9,
  openingBacklogQuintals: 400,
  weighbridgeCount: 2, // (2*9*60/12)*40 = 3600 qtl
  yardCapacityQuintals: 2000,
};

describe("capacity engine", () => {
  test("takes the minimum of the four constraints and names it", () => {
    const r = computeCapacity(balanced);
    assert.equal(r.sellableQuintals, 3000);
    assert.equal(r.bindingConstraint, "BARDANA");
  });

  test("each formula matches the documented arithmetic", () => {
    const r = computeCapacity(balanced);
    const by = (c: string) => r.breakdown.find((b) => b.constraint === c)?.quintals;

    assert.equal(by("BARDANA"), 6000 * OPS.QUINTALS_PER_BARDANA_BAG); // 3000
    assert.equal(by("LABOUR"), 9 * OPS.QUINTALS_PER_GANG_PER_DAY); // 3150
    // (2 bridges × 9h × 60) ÷ 12 min = 90 lots × 40 qtl
    assert.equal(by("WEIGHBRIDGE"), 3600);
    // 2000 capacity − 400 backlog + 8 trucks × 280
    assert.equal(by("YARD"), 3840);
  });

  test("always reports all four, so the officer screen can draw one scale", () => {
    const r = computeCapacity(balanced);
    assert.equal(r.breakdown.length, 4);
    assert.deepEqual(
      r.breakdown.map((b) => b.constraint),
      ["BARDANA", "LABOUR", "WEIGHBRIDGE", "YARD"],
    );
  });

  test("the binding constraint moves as the ground conditions move", () => {
    // Bardana lands: labour becomes the limit.
    assert.equal(
      computeCapacity({ ...balanced, bardanaBags: 20000 }).bindingConstraint,
      "LABOUR",
    );
    // Labour arrives too: the weighbridge is next.
    assert.equal(
      computeCapacity({ ...balanced, bardanaBags: 20000, labourGangs: 40 }).bindingConstraint,
      "WEIGHBRIDGE",
    );
    // Trucks fail to arrive and yesterday's stock is still on the floor.
    const yardBound = computeCapacity({
      ...balanced,
      bardanaBags: 20000,
      labourGangs: 40,
      trucksAssigned: 0,
      openingBacklogQuintals: 1500,
    });
    assert.equal(yardBound.bindingConstraint, "YARD");
    assert.equal(yardBound.sellableQuintals, 500);
  });

  test("a backlog larger than the yard is zero capacity, never negative", () => {
    const r = computeCapacity({
      ...balanced,
      trucksAssigned: 0,
      openingBacklogQuintals: 9999,
    });
    assert.equal(r.bindingConstraint, "YARD");
    assert.equal(r.sellableQuintals, 0);
  });

  test("survives the half-typed input it gets on every keystroke", () => {
    for (const bad of [NaN, -5, Infinity]) {
      const r = computeCapacity({ ...balanced, bardanaBags: bad });
      assert.ok(Number.isFinite(r.sellableQuintals), `finite for ${bad}`);
      assert.ok(r.sellableQuintals >= 0, `non-negative for ${bad}`);
    }
  });

  test("the explanation names something a farmer can act on", () => {
    assert.match(computeCapacity(balanced).explanation, /gunny bag|bagged/i);
  });

  test("bookable capacity prefers the officer's override", () => {
    assert.equal(bookableQuintals({ computedQuintals: 1000, approvedQuintals: 800 }), 800);
    assert.equal(bookableQuintals({ computedQuintals: 1000, approvedQuintals: null }), 1000);
    assert.equal(bookableQuintals({ computedQuintals: null, approvedQuintals: null }), 0);
    // 0 is a real override — the centre is closed today — and must not fall through.
    assert.equal(bookableQuintals({ computedQuintals: 1000, approvedQuintals: 0 }), 0);
  });
});

describe("slot allocator", () => {
  test("offered = sellable × (1 − standby) ÷ (1 − noShow)", () => {
    const a = allocate(1000, ALLOCATION_DEFAULTS);
    assert.equal(a.standbyQuintals, 100);
    // 900 / 0.92
    assert.equal(a.offeredQuintals, 978.3);
  });

  test("overbooking is modest by design, not aggressive", () => {
    // The whole point is to keep the yard busy without recreating the queue.
    const a = allocate(1000);
    assert.ok(a.offeredQuintals < 1000 * 1.05, "should not overbook heavily");
    assert.ok(a.offeredQuintals > 900, "should still use the standby headroom");
  });

  test("a no-show rate of 1 cannot divide by zero", () => {
    const a = allocate(1000, { standbyReserve: 0.1, noShowRate: 1 });
    assert.ok(Number.isFinite(a.offeredQuintals));
  });
});

describe("re-slotting", () => {
  const at = (iso: string) => new Date(iso);
  const booking = (
    id: string,
    qty: number,
    seniority: string,
    created = seniority,
  ): ReslotCandidate => ({
    id,
    farmerId: `f-${id}`,
    quantityQuintals: qty,
    seniorityAt: at(seniority),
    createdAt: at(created),
  });

  test("fills by quantity, not by head count", () => {
    // Four small trolleys and one big truck are not the same day's work.
    const r = reslotOverflow(
      [
        booking("a", 200, "2026-09-01T08:00:00Z"),
        booking("b", 200, "2026-09-01T09:00:00Z"),
        booking("c", 200, "2026-09-01T10:00:00Z"),
      ],
      500,
    );
    assert.deepEqual(r.keep.map((b) => b.id), ["a", "b"]);
    assert.deepEqual(r.overflow.map((b) => b.id), ["c"]);
    assert.equal(r.keptQuintals, 400);
  });

  test("the youngest bookings move first", () => {
    const r = reslotOverflow(
      [
        booking("young", 100, "2026-09-05T08:00:00Z"),
        booking("old", 100, "2026-09-01T08:00:00Z"),
      ],
      100,
    );
    assert.deepEqual(r.keep.map((b) => b.id), ["old"]);
    assert.deepEqual(r.overflow.map((b) => b.id), ["young"]);
  });

  test("seniorityAt protects a farmer already bumped once", () => {
    // `bumped` booked late today but carries seniority from an earlier slot it
    // was moved out of. Without this the system punishes the people it disrupted.
    const bumped = booking("bumped", 100, "2026-09-01T08:00:00Z", "2026-09-09T08:00:00Z");
    const fresh = booking("fresh", 100, "2026-09-08T08:00:00Z");

    const r = reslotOverflow([fresh, bumped], 100);
    assert.deepEqual(r.keep.map((b) => b.id), ["bumped"]);
    assert.deepEqual(r.overflow.map((b) => b.id), ["fresh"]);
  });

  test("a booking is kept whole or moved whole", () => {
    // Splitting a trolley across two days is not a thing that happens in a yard.
    const r = reslotOverflow([booking("big", 300, "2026-09-01T08:00:00Z")], 200);
    assert.equal(r.keep.length, 0);
    assert.equal(r.overflow.length, 1);
    assert.equal(r.keptQuintals, 0);
  });

  test("capacity unchanged moves nobody", () => {
    const bookings = [
      booking("a", 100, "2026-09-01T08:00:00Z"),
      booking("b", 100, "2026-09-01T09:00:00Z"),
    ];
    assert.equal(reslotOverflow(bookings, 200).overflow.length, 0);
  });

  test("the input array is not mutated", () => {
    const bookings = [
      booking("b", 100, "2026-09-02T08:00:00Z"),
      booking("a", 100, "2026-09-01T08:00:00Z"),
    ];
    reslotOverflow(bookings, 100);
    assert.deepEqual(bookings.map((b) => b.id), ["b", "a"]);
  });
});

describe("ETA", () => {
  test("uses today's observed rate once there is a sample", () => {
    // 120 minutes, 10 lots served = 12 min/lot; 5 ahead = 60 min.
    const e = estimateWaitMinutes(
      { servedSoFar: 10, minutesElapsedToday: 120, positionInQueue: 5 },
      20,
    );
    assert.equal(e.observedMinutesPerLot, 12);
    assert.equal(e.minutes, 60);
    assert.equal(e.fromObservedRate, true);
  });

  test("self-corrects when the centre slows down", () => {
    const fast = estimateWaitMinutes(
      { servedSoFar: 10, minutesElapsedToday: 120, positionInQueue: 5 },
      20,
    );
    // The weighbridge goes down: same lots served, far more time elapsed.
    const slow = estimateWaitMinutes(
      { servedSoFar: 10, minutesElapsedToday: 300, positionInQueue: 5 },
      20,
    );
    assert.ok(slow.minutes! > fast.minutes!, "ETA must slide on its own");
  });

  test("falls back to the planning figure before the sample means anything", () => {
    const e = estimateWaitMinutes(
      { servedSoFar: 1, minutesElapsedToday: 5, positionInQueue: 4 },
      15,
    );
    assert.equal(e.fromObservedRate, false);
    assert.equal(e.minutes, 60);
  });

  test("nobody ahead is no wait", () => {
    const e = estimateWaitMinutes(
      { servedSoFar: 10, minutesElapsedToday: 120, positionInQueue: 0 },
      12,
    );
    assert.equal(e.minutes, 0);
  });
});

describe("payment stages", () => {
  const none: PaymentTimestamps = {
    jFormIssuedAt: null,
    liftedAt: null,
    agencyAckAt: null,
    pfmsBatchAt: null,
    creditedAt: null,
  };
  const d = (iso: string) => new Date(iso);

  test("derives the furthest milestone that actually happened", () => {
    assert.equal(deriveStage(none), "AWAITING_JFORM");
    assert.equal(deriveStage({ ...none, jFormIssuedAt: d("2026-09-01T00:00:00Z") }), "J_FORM_ISSUED");
    assert.equal(
      deriveStage({ ...none, jFormIssuedAt: d("2026-09-01T00:00:00Z"), liftedAt: d("2026-09-02T00:00:00Z") }),
      "LIFTED",
    );
    assert.equal(deriveStage({ ...none, creditedAt: d("2026-09-05T00:00:00Z") }), "CREDITED");
  });

  test("a missed intermediate update does not hide a later truth", () => {
    // Lifting updates get missed in the field far more often than bank credits.
    // Reporting "awaiting lift" to a farmer whose money has landed would destroy
    // confidence in the tracker.
    const credited = { ...none, jFormIssuedAt: d("2026-09-01T00:00:00Z"), creditedAt: d("2026-09-04T00:00:00Z") };
    assert.equal(deriveStage(credited), "CREDITED");
  });

  test("every stage names an accountable office", () => {
    for (const stage of ["AWAITING_JFORM", "J_FORM_ISSUED", "LIFTED", "AGENCY_ACKNOWLEDGED", "SENT_FOR_PAYMENT"] as const) {
      assert.ok(ownerOf(stage).length > 1, `${stage} needs an owner`);
      assert.notEqual(ownerOf(stage), "—");
    }
  });

  test("the SLA clock is 72 hours from the J-form", () => {
    const jForm = d("2026-09-01T00:00:00Z");
    assert.equal(slaDueAt(jForm).toISOString(), "2026-09-04T00:00:00.000Z");
  });

  test("breach is past due and not yet credited", () => {
    const jForm = d("2026-09-01T00:00:00Z");
    const t = { ...none, jFormIssuedAt: jForm };

    assert.equal(isBreached(t, d("2026-09-03T00:00:00Z")), false, "inside 72h");
    assert.equal(isBreached(t, d("2026-09-05T00:00:00Z")), true, "past 72h");
    assert.equal(hoursOverdue(t, d("2026-09-05T00:00:00Z")), 24);
  });

  test("a credited lot is never breached, however long it took", () => {
    // The clock exists to find money that has not arrived. Leaving paid farmers
    // on the escalation screen would bury the ones still waiting.
    const t = { ...none, jFormIssuedAt: d("2026-09-01T00:00:00Z"), creditedAt: d("2026-09-30T00:00:00Z") };
    assert.equal(isBreached(t, d("2026-10-01T00:00:00Z")), false);
    assert.equal(hoursOverdue(t, d("2026-10-01T00:00:00Z")), 0);
  });

  test("no J-form means the clock has not started", () => {
    assert.equal(isBreached(none, d("2030-01-01T00:00:00Z")), false);
  });

  test("money is integer paise end to end", () => {
    // 42.5 qtl at Rs 2300/qtl = Rs 97,750 = 9,775,000 paise
    assert.equal(amountPaise(42.5, 230000n), 9775000n);
    assert.equal(typeof amountPaise(10, 230000n), "bigint");
  });
});
