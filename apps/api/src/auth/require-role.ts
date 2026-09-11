/**
 * Role enforcement. This middleware is the only place a role gates anything.
 *
 * The React app mirrors it as a route guard so nobody stares at a panel that
 * 403s, but that guard ships in a bundle the user controls and is presentation,
 * not security. Every rule is re-checked here.
 */

import type { RequestHandler } from "express";
import type { Role } from "@mandi/shared";
import { resolveSession, type Session } from "./session.js";
import { forbiddenRole } from "../http/errors.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: Session;
    }
  }
}

/**
 * Attaches the resolved session without requiring one. Used by routes that
 * answer differently for a signed-out caller rather than rejecting them.
 */
export const withSession: RequestHandler = async (req, _res, next) => {
  try {
    req.session = await resolveSession(req);
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Requires one of the named roles.
 *
 * `admin` is deliberately not implicit: a route that both officers and admins
 * may call lists both, so reading the router tells you exactly who gets in.
 */
export function requireRole(...allowed: Role[]): RequestHandler {
  return async (req, _res, next) => {
    try {
      const session = await resolveSession(req);
      req.session = session;

      // A null role here means the account genuinely has none — resolveSession
      // throws 503 rather than returning null when the lookup failed.
      if (!session.role || !allowed.includes(session.role)) {
        throw forbiddenRole(
          allowed.length === 1
            ? `This action is for ${allowed[0]} accounts.`
            : `This action is for ${allowed.join(" or ")} accounts.`,
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Narrowing helper for handlers mounted behind `withSession` or `requireRole`. */
export function sessionOf(req: Express.Request): Session {
  const session = req.session;
  if (!session) {
    // A programming error, not a request error: the route was mounted without
    // the middleware that populates it.
    throw new Error("sessionOf() called on a route with no session middleware.");
  }
  return session;
}
