/**
 * The capacity engine.
 *
 * A procurement centre is a service system with four hard resources. On any
 * given day it can only accept as much grain as its *tightest* resource allows.
 * Existing state portals publish a fixed daily quota that ignores all four, so
 * their slots are promises nobody checked. This costs the day against each
 * resource, takes the minimum, and reports which one binds.
 *
 * It lives in `packages/shared` rather than in the API because it runs twice,
 * deliberately: in the browser as the officer types on /centre/capacity, so the
 * effect of one more truck is visible before anything is saved, and on the
 * server as the authority that writes CapacityDay and triggers re-slotting.
 * Two implementations of this would be one too many. It is a pure function of
 * plain numbers with no imports, so it stays trivial to unit-test and to replay
 * a synthetic arrival profile through.
 */

import type { Constraint } from "../domain.js";

/**
 * Operational assumptions, NOT measurements.
 *
 * They are collected here precisely so a domain expert can correct them without
 * touching logic. Before the presentation: if you can get district-level
 * observations for any of these, replace them and say so — a judge who works in
 * procurement will know whether 350 quintals per gang is plausible, and "we
 * measured this at Sangrur" beats "we assumed" every time. Where you cannot
 * measure, keep the assumption and state it. A declared assumption is
 * defensible; a hidden one is not.
 */
export const OPS = {
  /** One gunny bag holds 50 kg. */
  QUINTALS_PER_BARDANA_BAG: 0.5,
  /** One gang bags and stitches roughly this much per shift. */
  QUINTALS_PER_GANG_PER_DAY: 350,
  /** A serial gate: every lot is weighed, one at a time. */
  WEIGHBRIDGE_MINUTES_PER_LOT: 12,
  /** A trolley-load. */
  AVG_LOT_QUINTALS: 40,
  /** What one truck removes from the yard in a day. */
  QUINTALS_PER_TRUCK: 280,
} as const;

/** The officer's five daily inputs, plus the centre's fixed characteristics. */
export interface CapacityInput {
  // --- entered once a day by the centre officer ---
  bardanaBags: number;
  labourGangs: number;
  trucksAssigned: number;
  weighbridgeHours: number;
  openingBacklogQuintals: number;
  // --- fixed characteristics of the centre ---
  weighbridgeCount: number;
  yardCapacityQuintals: number;
}

export interface ConstraintLine {
  constraint: Constraint;
  /** Quintals this resource alone would allow. */
  quintals: number;
  /** Shown under the bar on the officer screen. */
  detail: string;
}

export interface CapacityResult {
  /** min() of the four. What the centre can actually honour today. */
  sellableQuintals: number;
  /** argmin. What to fix, as opposed to merely what you cannot do. */
  bindingConstraint: Constraint;
  /** All four, always, so the officer screen can draw them on one scale. */
  breakdown: ConstraintLine[];
  /** A sentence a farmer can act on. Travels with the re-slot SMS. */
  explanation: string;
}

/** Quintals are carried to one decimal place everywhere in this system. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** No resource can contribute negative capacity; a backlog larger than the yard means zero, not less. */
function atLeastZero(n: number): number {
  return n > 0 ? n : 0;
}

/**
 * Costs one day at one centre against all four resources.
 *
 * Negative and non-finite inputs are clamped rather than rejected: this runs on
 * every keystroke as the officer types, and a half-typed "-" or an empty field
 * must render a number rather than throw inside a render pass.
 */
export function computeCapacity(input: CapacityInput): CapacityResult {
  const bardanaBags = atLeastZero(input.bardanaBags);
  const labourGangs = atLeastZero(input.labourGangs);
  const trucksAssigned = atLeastZero(input.trucksAssigned);
  const weighbridgeHours = atLeastZero(input.weighbridgeHours);
  const openingBacklog = atLeastZero(input.openingBacklogQuintals);
  const weighbridgeCount = atLeastZero(input.weighbridgeCount);
  const yardCapacity = atLeastZero(input.yardCapacityQuintals);

  // Grain cannot leave the centre unbagged.
  const bardanaQuintals = bardanaBags * OPS.QUINTALS_PER_BARDANA_BAG;

  // Bagging and stitching is gang work, and a gang does one shift.
  const labourQuintals = labourGangs * OPS.QUINTALS_PER_GANG_PER_DAY;

  // A serial gate at ~12 minutes per lot, ~40 quintals per trolley.
  const lotsWeighable =
    (weighbridgeCount * weighbridgeHours * 60) / OPS.WEIGHBRIDGE_MINUTES_PER_LOT;
  const weighbridgeQuintals = lotsWeighable * OPS.AVG_LOT_QUINTALS;

  // Grain needs floor space. Yesterday's unlifted backlog is already occupying
  // it, and lifting frees more during the day — which is why lifting delays
  // show up here as tomorrow's capacity, and why they also hold up payment.
  const yardQuintals = atLeastZero(
    yardCapacity - openingBacklog + trucksAssigned * OPS.QUINTALS_PER_TRUCK,
  );

  const breakdown: ConstraintLine[] = [
    {
      constraint: "BARDANA",
      quintals: round1(bardanaQuintals),
      detail: `${bardanaBags} bags × ${OPS.QUINTALS_PER_BARDANA_BAG} qtl`,
    },
    {
      constraint: "LABOUR",
      quintals: round1(labourQuintals),
      detail: `${labourGangs} gangs × ${OPS.QUINTALS_PER_GANG_PER_DAY} qtl`,
    },
    {
      constraint: "WEIGHBRIDGE",
      quintals: round1(weighbridgeQuintals),
      detail: `${weighbridgeCount} × ${weighbridgeHours}h ÷ ${OPS.WEIGHBRIDGE_MINUTES_PER_LOT} min = ${Math.floor(lotsWeighable)} lots`,
    },
    {
      constraint: "YARD",
      quintals: round1(yardQuintals),
      detail: `${yardCapacity} capacity − ${openingBacklog} backlog + ${trucksAssigned} trucks × ${OPS.QUINTALS_PER_TRUCK} qtl`,
    },
  ];

  // argmin. Ties resolve to the earlier entry, which keeps the result stable as
  // the officer types rather than flickering between two equal constraints.
  let binding = breakdown[0] as ConstraintLine;
  for (const line of breakdown) {
    if (line.quintals < binding.quintals) binding = line;
  }

  return {
    sellableQuintals: binding.quintals,
    bindingConstraint: binding.constraint,
    breakdown,
    explanation: explain(binding),
  };
}

/**
 * Names the constraint in words the farmer gets in an SMS.
 *
 * "Bardana shortage at the centre" is a sentence someone can act on. "Slot
 * unavailable" is not, and an unexplained delay is exactly what sends farmers
 * back to sleeping in the queue overnight.
 */
function explain(binding: ConstraintLine): string {
  const capacity = `${binding.quintals} quintals can be accepted today`;
  switch (binding.constraint) {
    case "BARDANA":
      return `${capacity}. Gunny bags are the limit — grain cannot be accepted faster than it can be bagged.`;
    case "LABOUR":
      return `${capacity}. Labour gangs are the limit — bagging and stitching capacity is short.`;
    case "WEIGHBRIDGE":
      return `${capacity}. The weighbridge is the limit — every lot is weighed one at a time.`;
    case "YARD":
      return `${capacity}. Yard space is the limit — unlifted stock from earlier days is still occupying the floor.`;
  }
}

/**
 * What the officer actually published, which may be their override of the
 * computed figure. Callers should use this rather than reading either field, so
 * "computed" and "approved" cannot be confused at a call site.
 */
export function bookableQuintals(day: {
  computedQuintals: number | null;
  approvedQuintals: number | null;
}): number {
  return day.approvedQuintals ?? day.computedQuintals ?? 0;
}
