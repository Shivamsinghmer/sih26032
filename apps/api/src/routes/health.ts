/**
 * `GET /health` — unauthenticated.
 *
 * Railway uses it for health checks, and it is the fastest way to tell a cold
 * Neon compute from a broken deploy: the first request after an idle spell
 * answers with `ok: true` and a `dbLatencyMs` in the thousands.
 */

import { Router } from "express";
import type { HealthResponse } from "@mandi/shared";
import { pingDb } from "../db.js";
import { env } from "../env.js";

export const healthRouter: Router = Router();

healthRouter.get("/health", async (_req, res) => {
  const ping = await pingDb();

  const body: HealthResponse = {
    ok: ping.up,
    db: ping.up ? "up" : "down",
    dbLatencyMs: ping.latencyMs,
    demoMode: env.demoMode,
  };

  // 503 on a database that is down, so an orchestrator restarting on a failed
  // health check sees a failure rather than a 200 with `ok: false` in the body.
  res.status(ping.up ? 200 : 503).json(body);
});
