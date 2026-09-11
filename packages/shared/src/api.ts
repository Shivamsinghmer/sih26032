/**
 * REST response shapes. See docs/API.md for the full contract.
 *
 * Conventions that hold everywhere:
 *   dates       ISO 8601 strings, UTC. The client formats for en-IN; the server never does.
 *   money       integer paise, never a float — 18.10 has no exact binary representation.
 *   quantities  quintals, number, one decimal place.
 */

import type { BookingStatus, Constraint, Crop, Locale, PaymentStage, Role } from "./domain.js";

export const API_PREFIX = "/api/v1";

/** `GET /health` — unauthenticated, used by Railway and to tell a cold Neon compute from a broken deploy. */
export interface HealthResponse {
  ok: boolean;
  db: "up" | "down";
  /** Milliseconds the database round trip took. A cold Neon wake shows up here as multiple seconds. */
  dbLatencyMs: number;
  /** True when auth is off because CLERK_SECRET_KEY is blank. The nav renders a badge from this. */
  demoMode: boolean;
}

export interface FarmerDto {
  id: string;
  name: string;
  village: string;
  district: string;
  state: string;
  landAcres: number | null;
  landVerified: boolean;
  aadhaarVerified: boolean;
  preferredLocale: Locale;
}

export interface OfficerDto {
  id: string;
  name: string;
  centreId: string | null;
  centreName: string | null;
}

/**
 * `GET /me` — the first call the web app makes once Clerk reports a session,
 * and everything the router needs to pick a panel and a gate.
 *
 * A failed lookup must return 503, never `role: null`. Collapsing "we could not
 * find out" into "there is nothing" is what turned an outage into an infinite
 * onboarding redirect in the previous build. See AUTH.md.
 */
export interface MeResponse {
  userId: string;
  role: Role | null;
  demoMode: boolean;
  gates: {
    /** false -> /onboarding */
    hasProfile: boolean;
    /** false -> /onboarding/verify; blocks every /farmer route */
    aadhaarVerified: boolean;
  };
  /** Present when role=farmer and hasProfile. */
  farmer: FarmerDto | null;
  /** Present when role=officer|admin. */
  officer: OfficerDto | null;
}

// ---------------------------------------------------------------------------
// Farmer panel
// ---------------------------------------------------------------------------

export interface CentreSummary {
  id: string;
  name: string;
  village?: string;
}

export interface NextBookingDto {
  id: string;
  tokenNumber: number | null;
  slotStart: string;
  slotEnd: string;
  status: BookingStatus;
  /** Present on a RESLOTTED booking: why it moved, in the farmer's language. */
  reslotReason: string | null;
  quantityQuintals: number;
  gatePassCode: string;
  centre: CentreSummary;
}

/**
 * A lot with its payment state.
 *
 * `stage`, `owner`, `breached` and `hoursOverdue` are all DERIVED server-side
 * from the timestamps below. The client renders them and never recomputes them —
 * two implementations of one state machine is one too many.
 */
export interface LotDto {
  id: string;
  centre?: CentreSummary;
  stage: PaymentStage;
  owner: string;
  slaDueAt: string | null;
  breached: boolean;
  hoursOverdue: number;
  netQuintals: number | null;
  /** Integer paise as a string — JSON has no bigint, and a double would lose precision. */
  amountPaise: string | null;
  jFormNumber: string | null;
  jFormIssuedAt: string | null;
  liftedAt?: string | null;
  agencyAckAt?: string | null;
  pfmsBatchAt?: string | null;
  creditedAt?: string | null;
  qualityPass?: boolean | null;
  moisturePercent?: number | null;
  rejectionReason?: string | null;
}

export interface FarmerDashboard {
  nextBooking: NextBookingDto | null;
  latestLot: LotDto | null;
}

export interface QueueContext {
  booking: {
    id: string;
    tokenNumber: number | null;
    slotStart: string;
    status: BookingStatus;
    gatePassCode: string;
    reslotReason: string | null;
    centre: CentreSummary;
  } | null;
  queue: {
    nowServingToken: number | null;
    ahead: number;
    servedToday: number;
    etaMinutes: number | null;
    /** The centre's observed rate today, so the UI can say "based on today's pace". */
    observedMinutesPerLot: number | null;
    etaFromObservedRate: boolean;
  } | null;
}

export interface CentreListItem {
  id: string;
  name: string;
  code: string;
  village: string;
  district: string;
  state: string;
  openHour: number;
  closeHour: number;
  latitude: number | null;
  longitude: number | null;
}

export interface SlotDay {
  date: string;
  capacityDayId: string;
  sellableQuintals: number;
  offeredQuintals: number;
  /** What is left after existing bookings. A day that cannot fit is not returned at all. */
  remainingQuintals: number;
  bindingConstraint: Constraint | null;
  openHour: number;
  closeHour: number;
}

export interface SlotsResponse {
  landAcres: number | null;
  landVerified: boolean;
  days: SlotDay[];
}

export interface CreateBookingRequest {
  centreId: string;
  slotStart: string;
  quantityQuintals: number;
  crop: Crop;
}
