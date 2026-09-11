import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { replay, peakWeekScenario, type ReplayScenario } from "./replay.js";

describe("replay harness", () => {
  test("the capacity-aware scheduler wastes fewer journeys", () => {
    const c = replay(peakWeekScenario());
    assert.ok(
      c.capacityAware.wastedTrips < c.fixedQuota.wastedTrips,
      `expected fewer wasted trips, got ${c.capacityAware.wastedTrips} vs ${c.fixedQuota.wastedTrips}`,
    );
    assert.ok(c.delta.wastedTripsAvoided > 0);
  });

  test("it refuses more journeys BEFORE travel, which is the mechanism", () => {
    // Not a side effect — this is how the wasted trips are avoided. A system
    // that refuses nothing in advance cannot prevent a trip.
    const c = replay(peakWeekScenario());
    assert.ok(c.capacityAware.refusedBeforeTravel > c.fixedQuota.refusedBeforeTravel);
  });

  test("it does not buy less grain to achieve that", () => {
    // The cheap way to cut wasted trips is to refuse everybody. Guard against
    // a "win" that just procures less.
    const c = replay(peakWeekScenario());
    assert.ok(
      c.capacityAware.servedQuintals >= c.fixedQuota.servedQuintals * 0.95,
      `served ${c.capacityAware.servedQuintals} vs ${c.fixedQuota.servedQuintals}`,
    );
  });

  test("the yard peaks lower", () => {
    const c = replay(peakWeekScenario());
    assert.ok(c.capacityAware.peakYardQuintals <= c.fixedQuota.peakYardQuintals);
  });

  test("when nothing goes wrong, the two are close", () => {
    // A week with steady resources and arrivals inside capacity should NOT
    // show a dramatic difference. A harness that always favours us is not
    // measuring anything.
    const steady: ReplayScenario = {
      centre: { weighbridgeCount: 2, yardCapacityQuintals: 2000, openHours: 9 },
      days: Array.from({ length: 4 }, (_, i) => ({
        label: `D${i}`, bardanaBags: 6000, labourGangs: 9, trucksAssigned: 7, weighbridgeHours: 9,
      })),
      arrivalsQuintals: [1200, 1200, 1200, 1200],
      fixedQuotaQuintals: 2000,
      moistureFailureRate: 0,
    };
    const c = replay(steady);
    assert.equal(c.capacityAware.wastedTrips, c.fixedQuota.wastedTrips);
    assert.equal(c.capacityAware.servedQuintals, c.fixedQuota.servedQuintals);
  });

  test("is deterministic", () => {
    const a = replay(peakWeekScenario());
    const b = replay(peakWeekScenario());
    assert.deepEqual(a, b);
  });
});
