/**
 * The Express app, assembled but not listening — so a test can import it
 * without binding a port.
 *
 * Middleware order is the request path from docs/ARCHITECTURE.md:
 *   clerkMiddleware -> requireRole -> zod parse -> handler
 */

import express, { type Express } from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { API_PREFIX } from "@mandi/shared";
import { env } from "./env.js";
import { errorHandler, notFoundHandler } from "./http/error-handler.js";
import { healthRouter } from "./routes/health.js";
import { meRouter } from "./routes/me.js";
import { onboardingRouter } from "./routes/onboarding.js";
import { verifyRouter } from "./routes/verify.js";
import { farmerRouter } from "./routes/farmer.js";
import { centreRouter } from "./routes/centre.js";
import { adminRouter } from "./routes/admin.js";

export function createApp(): Express {
  const app = express();

  // Railway terminates TLS ahead of the process, so req.protocol and the
  // client IP are only correct with the proxy trusted.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  /**
   * Money is stored as integer paise in `BigInt` columns, and `JSON.stringify`
   * throws on a bigint rather than coercing it. Serialising them here — once,
   * for every response — rather than at each call site, because the call-site
   * approach already failed: `amountPaise` was converted and
   * `mspPaisePerQuintal` on the same row was not, and the endpoint 500'd.
   *
   * Strings, not numbers: a paise value large enough to matter would lose
   * precision as a double, which is the whole reason these are integers.
   */
  app.set("json replacer", (_key: string, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );

  // Exactly the web origin, never `*`: with `*` any page on the internet can
  // call this API with a token it phished. The session rides on the
  // Authorization header rather than a cookie, so credentials stay off.
  app.use(
    cors({
      origin: env.webOrigins,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
      maxAge: 86_400,
    }),
  );

  app.use(express.json({ limit: "1mb" }));

  // Verifies the Bearer token against Clerk's cached JWKS — a local signature
  // check, no network call per request. Skipped entirely in demo mode, where
  // there is no secret key to verify against.
  if (!env.demoMode) {
    app.use(clerkMiddleware());
  }

  // Unversioned and unauthenticated, so a health check never depends on the
  // auth layer it is meant to help diagnose.
  app.use(healthRouter);

  // Versioning from day one costs nothing and means a breaking change never has
  // to be coordinated across two deploys in one evening.
  const v1 = express.Router();
  v1.use(meRouter);
  v1.use(onboardingRouter);
  v1.use(verifyRouter);
  v1.use(farmerRouter);
  v1.use(centreRouter);
  v1.use(adminRouter);
  app.use(API_PREFIX, v1);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
