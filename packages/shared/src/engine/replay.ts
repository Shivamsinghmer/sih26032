/**
 * The replay harness.
 *
 * The problem statement's fifth ask — "reduces congestion and waiting time" —
 * is measurable, so it should be measured rather than asserted. This runs one
 * arrival profile through two schedulers and reports the difference:
 *
 *   · **fixed quota** — what state portals do today: a flat daily number,
 *     published in advance, that ignores what the centre actually has.
 *   · **capacity-aware** — this project: the day costed against bardana,
 *     labour, weighbridge and yard, with slots offered only against it.
 *
 * ## What this is, and is not
 *
 * It is a **simulation with declared assumptions**, not field data. Nobody has
 * measured a real mandi with and without this system, and pretending otherwise
 * in front of a procurement panel is how a team loses credibility. What it does
 * prove is narrower and still worth saying: *given* a centre whose resources
 * move day to day, scheduling against those resources produces fewer wasted
 * journeys and a flatter yard than scheduling against a flat quota — and by how
 * much, under stated conditions.
 *
 * Every number the simulation depends on is in `ReplayScenario` so it can be
 * challenged, and the whole thing is deterministic so a result can be checked.
 */

import { computeCapacity, OPS, type CapacityInput } from "./capacity-engine.js";
import { allocate, ALLOCATION_DEFAULTS, type AllocationPolicy } from "./slot-allocator.js";

/** One day's ground conditions at the centre. */
export interface ReplayDay {
  label: string;
  bardanaBags: number;
  labourGangs: number;
  trucksAssigned: number;
  weighbridgeHours: number;
}

export interface ReplayScenario {
  centre: { weighbridgeCount: number; yardCapacityQuintals: number; openHours: number };
  days: ReplayDay[];
  /** Quintals wanting to sell each day, before any scheduling. */
  arrivalsQuintals: number[];
  /** What a fixed-quota portal publishes every day regardless of conditions. */
  fixedQuotaQuintals: number;
  /** Share of a day's arrivals that turn up above the moisture limit. */
  moistureFailureRate: number;
  policy?: AllocationPolicy;
}

export interface SchedulerResult {
  name: string;
  /** Quintals actually bought. */
  servedQuintals: number;
  /**
   * Journeys made that ended without a sale — the metric a farmer feels.
   * A fixed quota produces these at the gate; a capacity-aware one prevents
   * most by never offering the slot.
   */
  wastedTrips: number;
  /** Journeys prevented because the system refused to promise what it could not keep. */
  refusedBeforeTravel: number;
  /** Mean hours between arriving at the centre and being served. */
  meanDwellHours: number;
  /** Share of served lots handled on the day they were promised. */
  slotHonourRate: number;
  /** The worst single-day pile-up, in quintals. */
  peakYardQuintals: number;
  /** Quintals still on the floor at the end of the run. */
  carriedOverQuintals: number;
  /** Demand still waiting for a slot when the week ended. */
  unsoldAtEndQuintals: number;
  perDay: {
    label: string;
    offeredQuintals: number;
    sellableQuintals: number;
    arrivedQuintals: number;
    servedQuintals: number;
    turnedAwayQuintals: number;
    yardQuintals: number;
  }[];
}

export interface ReplayComparison {
  fixedQuota: SchedulerResult;
  capacityAware: SchedulerResult;
  delta: {
    wastedTripsAvoided: number;
    dwellHoursSaved: number;
    honourRatePoints: number;
    peakYardReduction: number;
  };
}

/** A trolley-load, used to turn quintals into countable journeys. */
const LOT = OPS.AVG_LOT_QUINTALS;

function round(n: number, dp = 1): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** What the centre can physically process that day, whatever was promised. */
function actualCapacity(scenario: ReplayScenario, day: ReplayDay, backlog: number): number {
  const input: CapacityInput = {
    bardanaBags: day.bardanaBags,
    labourGangs: day.labourGangs,
    trucksAssigned: day.trucksAssigned,
    weighbridgeHours: day.weighbridgeHours,
    openingBacklogQuintals: backlog,
    weighbridgeCount: scenario.centre.weighbridgeCount,
    yardCapacityQuintals: scenario.centre.yardCapacityQuintals,
  };
  return computeCapacity(input).sellableQuintals;
}

/**
 * Runs the scenario.
 *
 * `offeredFor` is the only difference between the two schedulers: it decides
 * what the system promises for a day. Everything after it — what the centre can
 * really do, who waits, who is turned away — is identical, which is what makes
 * the comparison fair.
 */
function simulate(
  name: string,
  scenario: ReplayScenario,
  offeredFor: (day: ReplayDay, index: number, backlog: number) => number,
): SchedulerResult {
  let backlog = 0;            // unlifted stock occupying the yard
  let waiting = 0;            // quintals that arrived and were not served, still queueing
  /**
   * Demand refused on an earlier day, still wanting to sell.
   *
   * Without this the comparison is rigged: a farmer the system declines to book
   * would simply disappear, so the scheduler that refuses more would look like
   * it procures less. In reality they book the next day that can take them, and
   * that is the whole promise — the grain is still bought, the journey is just
   * not wasted. A guard test caught exactly this.
   */
  let deferred = 0;
  let served = 0;
  let wastedTrips = 0;
  let refusedBeforeTravel = 0;
  let dwellQuintalHours = 0;  // quintals × hours waited, for a weighted mean
  let servedOnPromisedDay = 0;
  let peakYard = 0;

  const perDay: SchedulerResult["perDay"] = [];

  for (const [i, day] of scenario.days.entries()) {
    const wanting = (scenario.arrivalsQuintals[i] ?? 0) + deferred;
    const offered = offeredFor(day, i, backlog);

    // Anyone the system declines to book does not travel. This is the whole
    // point of the capacity-aware scheduler, and a fixed-quota one only does it
    // once its flat number is exhausted.
    // Existing queue occupies the day first; only the rest can be booked in.
    const roomForNewArrivals = Math.max(0, offered - waiting);
    const booked = Math.min(wanting, roomForNewArrivals);
    const refused = wanting - booked;
    refusedBeforeTravel += refused / LOT;
    // They come back, rather than evaporating.
    deferred = refused;

    // Everyone booked travels. Those already waiting from yesterday are still here.
    const arrived = booked;
    let onFloor = waiting + arrived;
    peakYard = Math.max(peakYard, onFloor + backlog);

    // Moisture failures are journeys made and wasted under BOTH schedulers —
    // the difference this project makes there is pre-arrival guidance, which is
    // not modelled here, so it is charged to both equally and stays honest.
    const moistureFailed = arrived * scenario.moistureFailureRate;
    onFloor -= moistureFailed;
    wastedTrips += moistureFailed / LOT;

    // What the centre can genuinely handle, whatever was promised.
    const capacity = actualCapacity(scenario, day, backlog);
    const servedToday = Math.min(onFloor, capacity);

    served += servedToday;
    servedOnPromisedDay += Math.min(servedToday, Math.max(0, arrived - moistureFailed));

    const leftover = onFloor - servedToday;
    // A day's worth of waiting for everyone not served, charged at the open hours.
    dwellQuintalHours += leftover * scenario.centre.openHours;
    // Anyone who travelled and was not served today made a wasted journey.
    wastedTrips += Math.max(0, leftover - waiting) / LOT;

    waiting = leftover;

    // Lifting removes stock from the floor; what is not lifted becomes tomorrow's backlog.
    const lifted = Math.min(backlog + servedToday, day.trucksAssigned * OPS.QUINTALS_PER_TRUCK);
    backlog = Math.max(0, backlog + servedToday - lifted);

    perDay.push({
      label: day.label,
      offeredQuintals: round(offered),
      sellableQuintals: round(capacity),
      arrivedQuintals: round(arrived),
      servedQuintals: round(servedToday),
      turnedAwayQuintals: round(leftover),
      yardQuintals: round(backlog + waiting),
    });
  }

  const servedLots = served / LOT;

  return {
    name,
    servedQuintals: round(served),
    unsoldAtEndQuintals: round(deferred),
    wastedTrips: Math.round(wastedTrips),
    refusedBeforeTravel: Math.round(refusedBeforeTravel),
    // Weighted by quantity, since a full truck waiting is not the same as a
    // small trolley waiting.
    meanDwellHours: round(servedLots > 0 ? dwellQuintalHours / served : 0, 2),
    slotHonourRate: round(served > 0 ? servedOnPromisedDay / served : 0, 3),
    peakYardQuintals: round(peakYard),
    carriedOverQuintals: round(waiting + backlog),
    perDay,
  };
}

/** Runs both schedulers over the same profile and reports the difference. */
export function replay(scenario: ReplayScenario): ReplayComparison {
  const policy = scenario.policy ?? ALLOCATION_DEFAULTS;

  // Today's portal: the same number every day, whatever the centre has.
  const fixedQuota = simulate("Fixed daily quota", scenario, () => scenario.fixedQuotaQuintals);

  // This project: cost the day, then offer against it.
  const capacityAware = simulate("Capacity-aware", scenario, (day, _i, backlog) =>
    allocate(actualCapacity(scenario, day, backlog), policy).offeredQuintals,
  );

  return {
    fixedQuota,
    capacityAware,
    delta: {
      wastedTripsAvoided: fixedQuota.wastedTrips - capacityAware.wastedTrips,
      dwellHoursSaved: round(fixedQuota.meanDwellHours - capacityAware.meanDwellHours, 2),
      honourRatePoints: round((capacityAware.slotHonourRate - fixedQuota.slotHonourRate) * 100, 1),
      peakYardReduction: round(fixedQuota.peakYardQuintals - capacityAware.peakYardQuintals),
    },
  };
}

/**
 * The scenario from CAPACITY-ENGINE.md: a peak-week surge into a centre with a
 * fixed weighbridge and a bardana shortfall on day three.
 */
export function peakWeekScenario(): ReplayScenario {
  return {
    centre: { weighbridgeCount: 2, yardCapacityQuintals: 2000, openHours: 9 },
    days: [
      { label: "Mon", bardanaBags: 5000, labourGangs: 8, trucksAssigned: 6, weighbridgeHours: 9 },
      { label: "Tue", bardanaBags: 5000, labourGangs: 8, trucksAssigned: 6, weighbridgeHours: 9 },
      // The shortfall. Bags did not land, and the trucks are short too.
      { label: "Wed", bardanaBags: 1200, labourGangs: 8, trucksAssigned: 2, weighbridgeHours: 9 },
      { label: "Thu", bardanaBags: 4000, labourGangs: 6, trucksAssigned: 3, weighbridgeHours: 7 },
      { label: "Fri", bardanaBags: 6000, labourGangs: 9, trucksAssigned: 7, weighbridgeHours: 9 },
      { label: "Sat", bardanaBags: 6000, labourGangs: 9, trucksAssigned: 7, weighbridgeHours: 9 },
    ],
    // A harvest-week surge: everyone wants to sell at once.
    arrivalsQuintals: [2200, 2400, 2600, 2400, 2000, 1600],
    // What a portal publishes: roughly the centre's good-day capacity, held flat.
    fixedQuotaQuintals: 2200,
    moistureFailureRate: 0.06,
  };
}

/** A one-line-per-row summary, for a CLI or a slide. */
export function formatComparison(c: ReplayComparison): string {
  const rows = [
    ["Metric", c.fixedQuota.name, c.capacityAware.name],
    ["Quintals bought", `${c.fixedQuota.servedQuintals}`, `${c.capacityAware.servedQuintals}`],
    ["Wasted journeys", `${c.fixedQuota.wastedTrips}`, `${c.capacityAware.wastedTrips}`],
    ["Refused before travel", `${c.fixedQuota.refusedBeforeTravel}`, `${c.capacityAware.refusedBeforeTravel}`],
    ["Mean dwell (hours)", `${c.fixedQuota.meanDwellHours}`, `${c.capacityAware.meanDwellHours}`],
    ["Slot honour rate", `${(c.fixedQuota.slotHonourRate * 100).toFixed(1)}%`, `${(c.capacityAware.slotHonourRate * 100).toFixed(1)}%`],
    ["Peak yard (qtl)", `${c.fixedQuota.peakYardQuintals}`, `${c.capacityAware.peakYardQuintals}`],
    ["Carried over (qtl)", `${c.fixedQuota.carriedOverQuintals}`, `${c.capacityAware.carriedOverQuintals}`],
  ];

  const w = [0, 1, 2].map((i) => Math.max(...rows.map((r) => r[i]!.length)));
  return rows
    .map((r, i) =>
      [r[0]!.padEnd(w[0]!), r[1]!.padStart(w[1]!), r[2]!.padStart(w[2]!)].join("  ") +
      (i === 0 ? `\n${"-".repeat(w[0]! + w[1]! + w[2]! + 4)}` : ""),
    )
    .join("\n");
}
