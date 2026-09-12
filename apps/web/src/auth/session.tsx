/**
 * `GET /me` on the client, and the route guards that read it.
 *
 * **None of this is security.** Every rule here is re-checked in the API, which
 * is the only place a check cannot be edited out. This exists so nobody stares
 * at a panel that 403s — deleting it would make the app uglier and no less safe.
 *
 * The one rule that is load-bearing: a 503 is NOT a negative answer. On 503 the
 * app shows a retry panel and stays put. Reading it as "no role" and redirecting
 * to onboarding is what made the previous build loop until the browser killed
 * the navigation.
 */

import { createContext, useContext, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { MeResponse, Role } from "@mandi/shared";
import { apiGet, ApiRequestError } from "../lib/api.js";
import { BootSkeleton } from "./provider.js";

const MeContext = createContext<MeResponse | null>(null);

export function useMe(): MeResponse {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe() outside <RequireSession>. Mount the guard first.");
  return me;
}

export function useMeQuery(): UseQueryResult<MeResponse, ApiRequestError> {
  return useQuery<MeResponse, ApiRequestError>({
    queryKey: ["me"],
    queryFn: ({ signal }) => apiGet<MeResponse>("/me", undefined, signal),
    staleTime: 60_000,
    retry: (failureCount, error) => {
      // 401 and 403 are answers — retrying them just delays the redirect.
      // 503 and network failures are worth retrying, because they are not.
      if (error.isUnauthenticated || error.isForbidden) return false;
      return failureCount < 3;
    },
  });
}

/** Shown on 503 or a dead network. Deliberately does not navigate anywhere. */
function RetryPanel({ error, onRetry }: { error: ApiRequestError; onRetry: () => void }) {
  return (
    <div className="grid min-h-dvh place-content-center justify-items-center gap-4 px-6 text-center">
      <h1 className="text-heading-sm font-semibold">We could not reach the service</h1>
      <p className="max-w-prose text-body text-graphite">{error.message}</p>
      {/* A 503 really is usually a cold database. A network failure is not —
          saying so sends people to look in the wrong place. */}
      <p className="max-w-prose text-body-sm text-stone">
        {error.code === "network"
          ? "The app loaded, but it cannot reach its API. That is a configuration problem rather than a passing outage."
          : "This is usually the database waking up after an idle spell, and it clears in a few seconds."}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="transition-notion rounded-button bg-notion-blue px-4 py-2 text-body-sm font-medium text-pure-white hover:opacity-90"
      >
        Try again
      </button>
    </div>
  );
}

/**
 * Resolves `/me` and provides it. Redirects to sign-in on 401.
 *
 * Everything below this in the tree can call `useMe()` without a null check.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const location = useLocation();
  const query = useMeQuery();

  if (query.isPending) return <BootSkeleton />;

  if (query.isError) {
    if (query.error.isUnauthenticated) {
      return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
    }
    // 503, network, or anything else we cannot interpret: stay put and offer a
    // retry. Never redirect on an outage.
    return <RetryPanel error={query.error} onRetry={() => void query.refetch()} />;
  }

  return <MeContext.Provider value={query.data}>{children}</MeContext.Provider>;
}

/**
 * The two farmer gates, in the order the API enforces them.
 *
 * Registration is a continuation of signing up, not a section of the dashboard:
 * until both gates are open every dashboard link would be dead.
 */
export function RequireFarmerGates({ children }: { children: ReactNode }) {
  const me = useMe();

  if (!me.gates.hasProfile) return <Navigate to="/onboarding" replace />;
  if (!me.gates.aadhaarVerified) return <Navigate to="/onboarding/verify" replace />;

  return <>{children}</>;
}

/** Mirrors `requireRole()` on the API, for presentation only. */
export function RequireRole({ allow, children }: { allow: Role[]; children: ReactNode }) {
  const me = useMe();

  if (!me.role) return <Navigate to="/onboarding" replace />;

  if (!allow.includes(me.role)) {
    // Send them to the panel they actually have, rather than a dead end.
    return <Navigate to={homeFor(me.role)} replace />;
  }

  return <>{children}</>;
}

/** Where an account belongs, given its role. */
export function homeFor(role: Role | null): string {
  switch (role) {
    case "farmer": return "/farmer";
    case "officer": return "/centre";
    case "admin": return "/admin";
    default: return "/onboarding";
  }
}
