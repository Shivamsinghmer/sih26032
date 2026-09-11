/**
 * The single exit for every failure. Express 5 forwards a rejected async
 * handler here automatically, so routes can `throw` and never wrap themselves
 * in try/catch just to produce a response body.
 */

import type { ErrorRequestHandler, RequestHandler } from "express";
import type { ApiError } from "@mandi/shared";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { HttpError } from "./errors.js";
import { env } from "../env.js";

export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ApiError = { error: `No route for ${req.method} ${req.path}.`, code: "not_found" };
  res.status(404).json(body);
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const { status, body } = translate(err);

  // 5xx is ours to fix, so it is always logged with the stack. 4xx is the
  // caller's, and logging every one of them buries the real faults.
  if (status >= 500) console.error(err);

  res.status(status).json(body);
};

function translate(err: unknown): { status: number; body: ApiError } {
  if (err instanceof HttpError) {
    const body: ApiError = { error: err.message, code: err.code };
    if (err.fields) body.fields = err.fields;
    return { status: err.status, body };
  }

  if (err instanceof ZodError) {
    // Field paths so the client can render each message against its input
    // rather than dropping one sentence above the whole form.
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const path = issue.path.join(".") || "_";
      fields[path] ??= issue.message;
    }
    return {
      status: 400,
      body: { error: "Some of those details are not valid.", code: "validation_failed", fields },
    };
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002 unique violation — the caller raced someone else, or reused a phone.
    if (err.code === "P2002") {
      return { status: 409, body: { error: "That record already exists.", code: "phone_taken" } };
    }
    if (err.code === "P2025") {
      return { status: 404, body: { error: "Not found.", code: "not_found" } };
    }
  }

  // A cold Neon compute surfaces as an initialisation failure. It is transient,
  // so it must read as 503 and not as a 500 the client gives up on.
  if (
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError
  ) {
    return {
      status: 503,
      body: { error: "The database is waking up. Please try again in a moment.", code: "upstream_unavailable" },
    };
  }

  const message =
    env.isProduction || !(err instanceof Error)
      ? "Something went wrong on our side."
      : err.message;
  return { status: 500, body: { error: message, code: "internal" } };
}
