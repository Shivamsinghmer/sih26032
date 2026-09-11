/**
 * The single role resolver. Everything that needs to know who the caller is
 * calls this, and nothing else resolves a role independently.
 *
 * Why it is one function (docs/AUTH.md): in the previous build the role
 * fallback redirected to /onboarding to resolve the role server-side.
 * /onboarding resolved it, found a complete profile, and forwarded to /farmer —
 * which arrived at a gate that still could not read the role and redirected to
 * /onboarding again. Any account whose token did not carry a role looped until
 * the browser killed the navigation.
 *
 * Two rules keep it from coming back:
 *   1. One resolver, called by everything. Whatever decides a role must not
 *      delegate the decision to something that can redirect back into it.
 *   2. Absent roles are never cached. Caching the *absence* of a role bounces a
 *      farmer straight back to onboarding in the seconds after onboarding
 *      granted them one.
 */

import type { Request } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { isRole, type Role } from "@mandi/shared";
import { env } from "../env.js";
import { prisma } from "../db.js";
import { unauthenticated, upstreamUnavailable } from "../http/errors.js";

export interface Session {
  /** Clerk user id, or the synthetic id used in demo mode. */
  userId: string;
  /** Null means "this account genuinely has no role", never "we could not find out". */
  role: Role | null;
  demoMode: boolean;
}

const DEMO_USER_ID = "demo-user";

/** Resolved roles only, held for 60s. A role changed in the Clerk dashboard therefore takes up to a minute to apply. */
const ROLE_TTL_MS = 60_000;
const roleCache = new Map<string, { role: Role; expiresAt: number }>();

function cachedRole(userId: string): Role | null {
  const hit = roleCache.get(userId);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    roleCache.delete(userId);
    return null;
  }
  return hit.role;
}

/** Only ever called with a role that resolved. There is deliberately no way to cache `null`. */
function cacheRole(userId: string, role: Role): void {
  roleCache.set(userId, { role, expiresAt: Date.now() + ROLE_TTL_MS });
}

/** Called after onboarding grants a role, so the next request does not serve a stale miss. */
export function forgetRole(userId: string): void {
  roleCache.delete(userId);
}

/**
 * Resolves the caller.
 *
 * Throws 401 when there is no session at all, and 503 when Clerk cannot be
 * reached — never `role: null`, which the client would read as "new user" and
 * act on. A failed lookup is not a negative answer.
 */
export async function resolveSession(req: Request): Promise<Session> {
  if (env.demoMode) return resolveDemoSession();

  const auth = getAuth(req);
  if (!auth.userId) throw unauthenticated();

  const cached = cachedRole(auth.userId);
  if (cached) return { userId: auth.userId, role: cached, demoMode: false };

  // Fast path: the role rides on the session token when the Clerk dashboard has
  // "Customize session token" set to {"metadata": "{{user.public_metadata}}"}.
  // That makes verification a local signature check with no network call.
  const claimed = (auth.sessionClaims as { metadata?: { role?: unknown } } | undefined)?.metadata?.role;
  if (isRole(claimed)) {
    cacheRole(auth.userId, claimed);
    return { userId: auth.userId, role: claimed, demoMode: false };
  }

  // Slow path: the claim is absent, so ask the Backend API. Measured at 3912ms
  // cold and 424-1139ms warm here, which is why the dashboard step is worth
  // doing — but this stays a fallback, never a requirement.
  let metadataRole: unknown;
  try {
    const user = await clerkClient.users.getUser(auth.userId);
    metadataRole = user.publicMetadata?.["role"];
  } catch (error) {
    // Could not find out. This must not read as "no role".
    console.error("Clerk user lookup failed", error);
    throw upstreamUnavailable("We could not verify your account just now. Please try again.");
  }

  // Matched against the three known roles, so a stray or hand-edited metadata
  // value reads as no role rather than opening a panel.
  if (!isRole(metadataRole)) return { userId: auth.userId, role: null, demoMode: false };

  cacheRole(auth.userId, metadataRole);
  return { userId: auth.userId, role: metadataRole, demoMode: false };
}

/**
 * Demo mode: auth is off and the API resolves the first seeded farmer, so UI
 * work is never blocked on provisioning. Decided by the API — if the browser
 * decided, anyone could flip it with a devtools edit.
 */
async function resolveDemoSession(): Promise<Session> {
  try {
    const farmer = await prisma.farmer.findFirst({ orderBy: { createdAt: "asc" }, select: { clerkId: true } });
    return { userId: farmer?.clerkId ?? DEMO_USER_ID, role: "farmer", demoMode: true };
  } catch (error) {
    console.error("Demo session lookup failed", error);
    throw upstreamUnavailable("The database is waking up. Please try again in a moment.");
  }
}
