/**
 * The payment state machine.
 *
 * The stage is **always derived from timestamps**, never typed in and never
 * written directly, so the tracker the farmer sees cannot disagree with what
 * actually happened. `Lot.paymentStage` exists only as a denormalisation for
 * querying, and is recomputed from these same timestamps on every write.
 */

import { PAYMENT_SLA_HOURS, type PaymentStage } from "../domain.js";

/** The five timestamps, in the order they can legitimately occur. */
export interface PaymentTimestamps {
  jFormIssuedAt: Date | null;
  liftedAt: Date | null;
  agencyAckAt: Date | null;
  pfmsBatchAt: Date | null;
  creditedAt: Date | null;
}

/**
 * Derives the stage: the furthest milestone that has actually happened.
 *
 * Checked newest-first, so a lot whose intermediate timestamp was never
 * recorded still reports the truth. In the field a lifting update gets missed
 * far more often than a bank credit, and reporting "awaiting lift" to a farmer
 * whose money has already landed is the kind of error that destroys confidence
 * in the whole tracker.
 */
export function deriveStage(t: PaymentTimestamps): PaymentStage {
  if (t.creditedAt) return "CREDITED";
  if (t.pfmsBatchAt) return "SENT_FOR_PAYMENT";
  if (t.agencyAckAt) return "AGENCY_ACKNOWLEDGED";
  if (t.liftedAt) return "LIFTED";
  if (t.jFormIssuedAt) return "J_FORM_ISSUED";
  return "AWAITING_JFORM";
}

/**
 * The office accountable for moving a lot out of the stage it is stuck in.
 *
 * An escalation without a named office is just a complaint, which is precisely
 * why existing dashboards surface delays and nothing happens.
 */
export function ownerOf(stage: PaymentStage): string {
  switch (stage) {
    case "AWAITING_JFORM":
      return "Centre officer";
    case "J_FORM_ISSUED":
      // The J-form is cut but the lot has not moved: the truck is the blocker.
      return "Transport contractor";
    case "LIFTED":
      return "Procurement agency";
    case "AGENCY_ACKNOWLEDGED":
      return "District treasury";
    case "SENT_FOR_PAYMENT":
      return "Bank / PFMS";
    case "CREDITED":
      return "—";
  }
}

/** The 72-hour norm runs from the J-form, which is the moment the state takes ownership of the grain. */
export function slaDueAt(jFormIssuedAt: Date): Date {
  return new Date(jFormIssuedAt.getTime() + PAYMENT_SLA_HOURS * 60 * 60 * 1000);
}

/**
 * A lot is breached when it is past due and not yet credited.
 *
 * A credited lot is never breached however long it took: the clock exists to
 * find money that has not arrived, and leaving paid farmers on the escalation
 * screen would bury the ones still waiting.
 */
export function isBreached(
  t: PaymentTimestamps,
  now: Date = new Date(),
): boolean {
  if (t.creditedAt) return false;
  if (!t.jFormIssuedAt) return false;
  return now.getTime() > slaDueAt(t.jFormIssuedAt).getTime();
}

/** Whole hours past the SLA, for the running clock on the admin escalation screen. */
export function hoursOverdue(
  t: PaymentTimestamps,
  now: Date = new Date(),
): number {
  if (!t.jFormIssuedAt || t.creditedAt) return 0;
  const overdueMs = now.getTime() - slaDueAt(t.jFormIssuedAt).getTime();
  return overdueMs <= 0 ? 0 : Math.floor(overdueMs / (60 * 60 * 1000));
}

/**
 * Everything the payment tracker and the escalation row need, from one call —
 * so no caller can derive the stage one way and the breach another.
 */
export interface PaymentStatus {
  stage: PaymentStage;
  owner: string;
  slaDueAt: Date | null;
  breached: boolean;
  hoursOverdue: number;
}

export function paymentStatus(
  t: PaymentTimestamps,
  now: Date = new Date(),
): PaymentStatus {
  const stage = deriveStage(t);
  return {
    stage,
    owner: ownerOf(stage),
    slaDueAt: t.jFormIssuedAt ? slaDueAt(t.jFormIssuedAt) : null,
    breached: isBreached(t, now),
    hoursOverdue: hoursOverdue(t, now),
  };
}

/**
 * Value of a lot at the season's MSP.
 *
 * Integer paise throughout, and the MSP is read from SeasonConfig at the moment
 * the J-form is cut — never hard-coded, because it is notified per season on
 * CACP's recommendation. Floats have no business anywhere near money: 18.10 has
 * no exact binary representation.
 */
export function amountPaise(netQuintals: number, mspPaisePerQuintal: bigint): bigint {
  // Quintals carry one decimal place, so scale by 10 and divide back down in
  // integer arithmetic rather than multiplying a float by a bigint.
  const tenths = BigInt(Math.round(netQuintals * 10));
  return (tenths * mspPaisePerQuintal) / 10n;
}
