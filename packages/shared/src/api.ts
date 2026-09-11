/**
 * REST response shapes. See docs/API.md for the full contract.
 *
 * Conventions that hold everywhere:
 *   dates       ISO 8601 strings, UTC. The client formats for en-IN; the server never does.
 *   money       integer paise, never a float — 18.10 has no exact binary representation.
 *   quantities  quintals, number, one decimal place.
 */

import type { Locale, Role } from "./domain.js";

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
