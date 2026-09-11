import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./auth/provider.js";
import { router } from "./router.js";
import { ApiRequestError } from "./lib/api.js";
import "./styles/globals.css";

/**
 * Caching, retries and refetch-on-focus are the bulk of what SSR used to do for
 * us, so the defaults here matter more than they would in a server-rendered app.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Never retry an answer. 401/403/404/409 are decisions, not outages;
        // retrying them wastes a round trip on a bad connection and delays the
        // message the user needs to see.
        if (error instanceof ApiRequestError) {
          if (error.status >= 400 && error.status < 500) return false;
        }
        return failureCount < 3;
      },
    },
  },
});

const container = document.getElementById("root");
if (!container) throw new Error("#root missing from index.html");

/**
 * Register the service worker.
 *
 * Production only: in development a cached shell makes every change look like
 * it did not take, which costs far more time than the offline support saves.
 */
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      // Offline support is an enhancement; losing it must not break the app.
      console.warn("service worker registration failed", error);
    });
  });
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
