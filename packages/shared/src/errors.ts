/**
 * The error contract. Every non-2xx response from the API is
 * `{ error, code }` — a human sentence and a machine slug.
 *
 * The client branches on the HTTP status; the code narrows the reason within a
 * status, so a 409 on a booking can say *what* moved underneath the request.
 */

export const ERROR_CODES = [
  "validation_failed",     // 400
  "unauthenticated",       // 401
  "forbidden_role",        // 403
  "gate_aadhaar",          // 403 — authenticated farmer, verification incomplete
  "gate_profile",          // 403 — signed in, no farmer profile yet
  "not_found",             // 404
  "phone_taken",           // 409
  "capacity_moved",        // 409 — the day can no longer absorb this quantity
  "slot_gone",             // 409
  "qr_unparseable",        // 422
  "upstream_unavailable",  // 503 — Clerk or Neon did not answer
  "internal",              // 500
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  /** A sentence intended for a human, already in plain language. */
  error: string;
  code: ErrorCode;
  /** Present on 400 only: field path -> message, for rendering against a form. */
  fields?: Record<string, string>;
}
