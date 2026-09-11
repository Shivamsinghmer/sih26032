/**
 * Domain vocabulary shared by both services.
 *
 * Every union here mirrors an enum in `apps/api/prisma/schema.prisma`. Prisma is
 * the source of truth for what the database will accept; these exist so the
 * React app can name the same values without importing a Prisma client it has
 * no business holding. A rename that updates only one side fails the build.
 */

export const ROLES = ["farmer", "officer", "admin"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Matched exactly, so a stray or hand-edited `publicMetadata.role` reads as no
 * role rather than opening a panel. See AUTH.md, "Security rules".
 */
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export const LOCALES = ["hi", "pa", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const CROPS = ["PADDY", "WHEAT"] as const;
export type Crop = (typeof CROPS)[number];

/** `BOOKED → ARRIVED → IN_PROGRESS → COMPLETED`, with three exits. */
export const BOOKING_STATUSES = [
  "BOOKED",
  "ARRIVED",
  "IN_PROGRESS",
  "COMPLETED",
  "RESLOTTED",
  "NO_SHOW",
  "CANCELLED",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/**
 * The four hard resources a centre runs out of. Stored on `CapacityDay` so a
 * season's worth of rows answers "which resource limited this district most
 * often" — the question that should drive next year's tendering.
 */
export const CONSTRAINTS = ["BARDANA", "LABOUR", "WEIGHBRIDGE", "YARD"] as const;
export type Constraint = (typeof CONSTRAINTS)[number];

/** `DRAFT` until published; only `PUBLISHED` days are bookable. */
export const CAPACITY_STATUSES = ["DRAFT", "PUBLISHED"] as const;
export type CapacityStatus = (typeof CAPACITY_STATUSES)[number];

/**
 * Ordered, so `stageIndex()` can drive the farmer's progress tracker without a
 * second lookup table. Always derived from `Lot` timestamps, never typed in.
 */
export const PAYMENT_STAGES = [
  "AWAITING_JFORM",
  "J_FORM_ISSUED",
  "LIFTED",
  "AGENCY_ACKNOWLEDGED",
  "SENT_FOR_PAYMENT",
  "CREDITED",
] as const;
export type PaymentStage = (typeof PAYMENT_STAGES)[number];

export function stageIndex(stage: PaymentStage): number {
  return PAYMENT_STAGES.indexOf(stage);
}

export const NOTIFICATION_CHANNELS = ["SMS", "PUSH", "IVR"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * DLT-registered template keys. Indian commercial SMS requires pre-approved
 * bodies, so the key is operationally meaningful and not merely a log label.
 */
export const NOTIFICATION_TEMPLATES = [
  "SLOT_CONFIRMED",
  "SLOT_RESLOTTED",
  "MOISTURE_FAIL",
  "JFORM_ISSUED",
  "PAYMENT_CREDITED",
] as const;
export type NotificationTemplate = (typeof NOTIFICATION_TEMPLATES)[number];

export const VERIFICATION_METHODS = [
  "AADHAAR_SECURE_QR",
  "LAND_RECORD_MATCH",
  "OFFICER_ATTESTATION",
] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

/** The 72-hour payment norm, counted from the J-form timestamp. */
export const PAYMENT_SLA_HOURS = 72;
