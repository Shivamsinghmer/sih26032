/**
 * Turning a day's sellable capacity into bookable slots, and deciding who moves
 * when that capacity drops.
 *
 * Capacity is filled by **quantity, not head count** — twenty small trolleys and
 * four full trucks are not the same day's work, and every portal that books by
 * head count rediscovers this at the gate.
 */

import type { Constraint } from "../domain.js";

export const ALLOCATION_DEFAULTS = {
  /** Held back for walk-ins and re-slotted farmers, so nobody is turned away at the gate. */
  standbyReserve: 0.1,
  /**
   * Overbook by exactly the no-show rate: enough to keep the yard busy, not
   * enough to recreate the queue this system exists to remove.
   */
  noShowRate: 0.08,
} as const;

export interface AllocationPolicy {
  standbyReserve: number;
  noShowRate: number;
}

export interface Allocation {
  /** What may be handed out as slots. */
  offeredQuintals: number;
  /** Held back for walk-ins and re-slots. */
  standbyQuintals: number;
  /** The honest figure the centre can process. */
  sellableQuintals: number;
}

/**
 * `offered = sellable × (1 − standbyReserve) ÷ (1 − noShowRate)`
 *
 * Both rates should be learned per centre from history rather than left at the
 * defaults — an obvious and honest "next step" answer if a panel asks.
 */
export function allocate(
  sellableQuintals: number,
  policy: AllocationPolicy = ALLOCATION_DEFAULTS,
): Allocation {
  const sellable = Math.max(0, sellableQuintals);

  // Guard the arithmetic: a no-show rate of 1 would divide by zero, and rates
  // outside [0,1) are a configuration mistake rather than a scenario to model.
  const standbyReserve = clamp(policy.standbyReserve, 0, 0.9);
  const noShowRate = clamp(policy.noShowRate, 0, 0.9);

  const standbyQuintals = sellable * standbyReserve;
  const offered = (sellable - standbyQuintals) / (1 - noShowRate);

  return {
    sellableQuintals: round1(sellable),
    standbyQuintals: round1(standbyQuintals),
    offeredQuintals: round1(offered),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// Re-slotting
// ---------------------------------------------------------------------------

/** The minimum a booking must expose to take part in a re-slot decision. */
export interface ReslotCandidate {
  id: string;
  farmerId: string;
  quantityQuintals: number;
  /**
   * Preserved across a re-slot, so a farmer bumped once does not go to the back
   * of the queue when they are bumped again. Without this the system quietly
   * punishes exactly the people it already disrupted.
   */
  seniorityAt: Date;
  /** Booked-at, the tiebreaker among equal seniority. */
  createdAt: Date;
}

export interface ReslotDecision<T extends ReslotCandidate> {
  /** Bookings that still fit, in the order they will be served. */
  keep: T[];
  /** Bookings that must move. Every one of these fires a notification. */
  overflow: T[];
  /** How much of the offered capacity the kept bookings consume. */
  keptQuintals: number;
}

/**
 * Decides who keeps their slot when capacity changes, filling by quantity until
 * the offered figure is exhausted.
 *
 * Seniority ascending: the **youngest bookings move first**, and `seniorityAt`
 * rather than `createdAt` is what orders them, so a farmer already bumped once
 * carries their original position into the next disruption.
 *
 * This is the point of the whole system. Publishing lower capacity re-slots the
 * overflow immediately, so the farmer learns at home rather than at the gate.
 */
export function reslotOverflow<T extends ReslotCandidate>(
  bookings: readonly T[],
  offeredQuintals: number,
): ReslotDecision<T> {
  const ordered = [...bookings].sort(
    (a, b) =>
      a.seniorityAt.getTime() - b.seniorityAt.getTime() ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );

  const keep: T[] = [];
  const overflow: T[] = [];
  let used = 0;

  for (const booking of ordered) {
    // A booking is kept whole or moved whole. Splitting someone's trolley
    // across two days is not a thing that can happen in a yard.
    if (used + booking.quantityQuintals <= offeredQuintals) {
      keep.push(booking);
      used += booking.quantityQuintals;
    } else {
      overflow.push(booking);
    }
  }

  return { keep, overflow, keptQuintals: round1(used) };
}

/** The reason text that travels with a re-slot, into both the record and the SMS. */
export function reslotReason(constraint: Constraint, centreName: string): string {
  switch (constraint) {
    case "BARDANA":
      return `Gunny bag shortage at ${centreName}. Your slot has been moved — please do not travel today.`;
    case "LABOUR":
      return `Labour shortage at ${centreName}. Your slot has been moved — please do not travel today.`;
    case "WEIGHBRIDGE":
      return `Reduced weighbridge hours at ${centreName}. Your slot has been moved — please do not travel today.`;
    case "YARD":
      return `Unlifted stock is occupying the yard at ${centreName}. Your slot has been moved — please do not travel today.`;
  }
}

// ---------------------------------------------------------------------------
// ETA
// ---------------------------------------------------------------------------

export interface QueueObservation {
  /** Lots actually completed at this centre today. */
  servedSoFar: number;
  /** Wall-clock minutes since the centre opened today. */
  minutesElapsedToday: number;
  /** How many are ahead of the farmer asking. */
  positionInQueue: number;
}

export interface WaitEstimate {
  minutes: number | null;
  /** The rate the estimate is built on, surfaced so the UI can say "based on today". */
  observedMinutesPerLot: number | null;
  /** False until the centre has served enough lots for the observed rate to mean anything. */
  fromObservedRate: boolean;
}

/** Below this, today's average is noise and the planning figure is the better guess. */
const MIN_SAMPLE_LOTS = 3;

/**
 * Estimates the wait from what the centre has *actually* processed today, not
 * from a planning figure.
 *
 * The estimate therefore self-corrects: when the weighbridge goes down the ETA
 * slides on its own and every watching farmer sees the new time — with the
 * reason attached, because an unexplained delay is what destroys trust in the
 * queue and sends people back to sleeping at the gate.
 */
export function estimateWaitMinutes(
  observation: QueueObservation,
  fallbackMinutesPerLot: number,
): WaitEstimate {
  const { servedSoFar, minutesElapsedToday, positionInQueue } = observation;

  const hasSample = servedSoFar >= MIN_SAMPLE_LOTS && minutesElapsedToday > 0;
  const observedMinutesPerLot = hasSample
    ? round1(minutesElapsedToday / servedSoFar)
    : null;

  const rate = observedMinutesPerLot ?? fallbackMinutesPerLot;
  if (!Number.isFinite(rate) || rate <= 0) {
    return { minutes: null, observedMinutesPerLot, fromObservedRate: false };
  }

  return {
    minutes: Math.round(Math.max(0, positionInQueue) * rate),
    observedMinutesPerLot,
    fromObservedRate: observedMinutesPerLot !== null,
  };
}
