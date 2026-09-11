/**
 * Every failure leaves a handler as an HttpError, so the shape on the wire is
 * decided in one place instead of at each `res.status(...).json(...)` call site.
 */

import type { ErrorCode } from "@mandi/shared";

export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields: Record<string, string> | undefined;

  constructor(status: number, code: ErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new HttpError(400, "validation_failed", message, fields);

export const unauthenticated = (message = "Sign in to continue.") =>
  new HttpError(401, "unauthenticated", message);

export const forbiddenRole = (message = "This account does not have access to that panel.") =>
  new HttpError(403, "forbidden_role", message);

export const notFound = (message = "Not found.") => new HttpError(404, "not_found", message);

/**
 * The distinction that keeps the client from looping: a lookup that *failed* is
 * not the same as a negative answer. `GET /me` returns this rather than
 * `role: null` when Clerk or the database does not respond, so the client shows
 * a retry panel and stays put instead of bouncing the user into onboarding.
 */
export const upstreamUnavailable = (message = "We could not reach the service. Please try again.") =>
  new HttpError(503, "upstream_unavailable", message);
