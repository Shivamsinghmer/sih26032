/**
 * REST response shapes. See docs/API.md for the full contract.
 *
 * Conventions that hold everywhere:
 *   dates       ISO 8601 strings, UTC. The client formats for en-IN; the server never does.
 *   money       integer paise, never a float — 18.10 has no exact binary representation.
 *   quantities  quintals, number, one decimal place.
 */

import type { BookingStatus, CapacityStatus, Constraint, Crop, Locale, PaymentStage, Role } from "./domain.js";

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

// ---------------------------------------------------------------------------
// Centre officer panel
// ---------------------------------------------------------------------------

export interface CapacityDayDto {
  id: string;
  date: string;
  bardanaBags: number;
  labourGangs: number;
  trucksAssigned: number;
  weighbridgeHours: number;
  openingBacklogQuintals: number;
  computedQuintals: number | null;
  bindingConstraint: Constraint | null;
  /** The engine's four lines, so the officer screen can draw one scale. */
  breakdown: { constraint: Constraint; quintals: number; detail: string }[] | null;
  approvedQuintals: number | null;
  status: CapacityStatus;
  publishedAt: string | null;
}

export interface CentreDto {
  id: string;
  name: string;
  code: string;
  village: string;
  district: string;
  state: string;
  weighbridgeCount: number;
  openHour: number;
  closeHour: number;
  yardCapacityQuintals: number;
}

export interface QueueBookingDto {
  id: string;
  tokenNumber: number | null;
  slotStart: string;
  slotEnd: string;
  status: BookingStatus;
  quantityQuintals: number;
  gatePassCode: string;
  reslotReason: string | null;
  arrivedAt: string | null;
  farmer: { id: string; name: string; village: string; phone: string };
}

export interface BreachedLotDto {
  id: string;
  farmerName: string;
  village: string;
  stage: PaymentStage;
  owner: string;
  breached: boolean;
  hoursOverdue: number;
  amountPaise: string | null;
}

export interface CentreToday {
  centre: CentreDto;
  capacityDay: CapacityDayDto | null;
  bookingsToday: QueueBookingDto[];
  breachedLots: BreachedLotDto[];
  awaitingLift: number;
}

export interface CentreCapacityScreen {
  centre: CentreDto;
  date: string;
  capacityDay: CapacityDayDto | null;
  /** What is already committed on that day, so a cut's cost is visible first. */
  booked: { quintals: number; bookings: number };
}

export interface PublishCapacityRequest {
  date: string;
  bardanaBags: number;
  labourGangs: number;
  trucksAssigned: number;
  weighbridgeHours: number;
  openingBacklogQuintals: number;
  approvedQuintals?: number;
  publish: boolean;
}

export interface PublishCapacityResponse {
  sellableQuintals: number;
  bindingConstraint: Constraint;
  breakdown: { constraint: Constraint; quintals: number; detail: string }[];
  explanation: string;
  capacityDay: CapacityDayDto;
  offeredQuintals?: number;
  keptQuintals?: number;
  /** Every entry fires a notification. The officer sees exactly who was moved. */
  reslotted: { bookingId: string; farmerId: string; farmerName: string }[];
  published: boolean;
}

export interface CentreQueue {
  centre: CentreDto;
  bookings: QueueBookingDto[];
  stats: {
    total: number;
    served: number;
    waiting: number;
    inProgress: number;
    noShow: number;
    observedMinutesPerLot: number | null;
  };
}

export type QueueAction = "ARRIVE" | "START" | "COMPLETE" | "NO_SHOW";

export interface RecordLotRequest {
  bookingId: string;
  moisturePercent: number;
  netQuintals: number;
  crop: Crop;
}

// ---------------------------------------------------------------------------
// District admin panel
// ---------------------------------------------------------------------------

export interface AdminCentreRow {
  centre: { id: string; name: string; code: string; village: string };
  /** Null capacity means the officer has not entered today — itself the finding. */
  published: boolean;
  sellableQuintals: number | null;
  bindingConstraint: Constraint | null;
  bookingsToday: number;
  servedToday: number;
  breachedLots: number;
  awaitingLift: number;
}

export interface AdminOverview {
  date: string;
  kpis: {
    centres: number;
    farmers: number;
    breachedLots: number;
    centresNotPublished: number;
    bookingsToday: number;
    servedToday: number;
  };
  centres: AdminCentreRow[];
  /** Which resource limited this district most often — the tendering question. */
  constraintHistory: { constraint: Constraint | null; days: number }[];
}

export interface EscalationRow {
  lotId: string;
  farmer: { name: string; phone: string; village: string };
  centre: { id: string; name: string };
  jFormNumber: string | null;
  jFormIssuedAt: string | null;
  amountPaise: string | null;
  stage: PaymentStage;
  /** An escalation without a named office is just a complaint. */
  owner: string;
  breached: boolean;
  hoursOverdue: number;
  slaDueAt: string | null;
}
