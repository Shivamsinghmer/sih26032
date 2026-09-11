/**
 * Clerk, mounted only when there is a key to mount it with.
 *
 * With `VITE_CLERK_PUBLISHABLE_KEY` blank the app runs without a Clerk
 * provider and sends no token. **That is not what decides demo mode** — the API
 * decides that, from its own blank secret key, and reports it through `/me`. If
 * the browser decided, anyone could flip it with a devtools edit.
 *
 * So the two can disagree, and the disagreement is worth surfacing: a bundle
 * built without the key talking to an API that still enforces auth will get 401
 * on everything, which is confusing unless you are told why.
 */

import { type ReactNode, useEffect } from "react";
import { ClerkProvider, useAuth } from "@clerk/clerk-react";
import { setTokenProvider } from "../lib/api.js";

const PUBLISHABLE_KEY = (import.meta.env["VITE_CLERK_PUBLISHABLE_KEY"] ?? "").trim();

/** True when this bundle carries no Clerk key and therefore cannot sign anyone in. */
export const clerkConfigured = PUBLISHABLE_KEY.length > 0;

/**
 * Registers Clerk's `getToken` with the fetch wrapper.
 *
 * Rendered inside the provider so the hook is legal, and separated from it so
 * the no-key path does not need a fake context.
 */
function TokenBridge({ children }: { children: ReactNode }) {
  const { getToken, isLoaded } = useAuth();

  useEffect(() => {
    setTokenProvider(async () => {
      try {
        return await getToken();
      } catch {
        // An expired or revoked session. Send the request without a token and
        // let the API answer 401, which the guard already handles — better than
        // throwing here, where there is no way to explain it to the user.
        return null;
      }
    });
  }, [getToken]);

  // Clerk resolves the session asynchronously. Rendering children before that
  // would fire every loader with no token and 401 the whole first paint.
  if (!isLoaded) return <BootSkeleton />;

  return <>{children}</>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!clerkConfigured) {
    if (import.meta.env.PROD) {
      // A production bundle built without the key ships with auth off and no
      // error to warn you. Say so loudly; verifying a deploy otherwise means
      // grepping the built assets for the pk_ prefix.
      console.warn(
        "VITE_CLERK_PUBLISHABLE_KEY was missing when this bundle was built. No token will be sent. " +
          "If the API enforces auth, every request will 401.",
      );
    }
    return <>{children}</>;
  }

  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
      <TokenBridge>{children}</TokenBridge>
    </ClerkProvider>
  );
}

export function BootSkeleton() {
  return (
    <div className="grid min-h-dvh place-content-center justify-items-center gap-4 bg-paper-warmth">
      <div
        className="size-9 animate-spin rounded-full border-[3px] border-black/10 border-t-notion-blue motion-reduce:animate-none"
        role="status"
        aria-label="Loading"
      />
      <p className="text-body text-stone">Loading…</p>
    </div>
  );
}
