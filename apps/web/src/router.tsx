/**
 * Routes, in data mode.
 *
 * The boundary that matters is enforced in apps/api at the route level. These
 * guards mirror it so nobody is sent to a panel that 403s — see docs/ARCHITECTURE.md.
 */

import { createBrowserRouter, Outlet } from "react-router";
import { RequireSession } from "./auth/session.js";
import { Landing } from "./routes/landing.js";
import { SignInPage, SignUpPage } from "./routes/auth-pages.js";
import { OnboardingLayout, OnboardingProfile, OnboardingVerify } from "./routes/onboarding.js";
import {
  FarmerLayout,
  CentreLayout, CentreHome,
  AdminLayout, AdminHome,
  NotFound,
} from "./routes/panels.js";
import { FarmerDashboard, FarmerBook, FarmerQueue, FarmerPayments } from "./routes/farmer.js";

/** Everything below this resolves /me once and shares it. */
function SessionBoundary() {
  return (
    <RequireSession>
      <Outlet />
    </RequireSession>
  );
}

export const router = createBrowserRouter([
  // Public: these must render for a signed-out visitor.
  { path: "/", element: <Landing /> },
  { path: "/sign-in/*", element: <SignInPage /> },
  { path: "/sign-up/*", element: <SignUpPage /> },

  {
    element: <SessionBoundary />,
    children: [
      {
        path: "/onboarding",
        element: <OnboardingLayout />,
        children: [
          { index: true, element: <OnboardingProfile /> },
          { path: "verify", element: <OnboardingVerify /> },
        ],
      },
      {
        path: "/farmer",
        element: <FarmerLayout />,
        children: [
          { index: true, element: <FarmerDashboard /> },
          { path: "book", element: <FarmerBook /> },
          { path: "queue", element: <FarmerQueue /> },
          { path: "payments", element: <FarmerPayments /> },
        ],
      },
      {
        path: "/centre",
        element: <CentreLayout />,
        children: [{ index: true, element: <CentreHome /> }],
      },
      {
        path: "/admin",
        element: <AdminLayout />,
        children: [{ index: true, element: <AdminHome /> }],
      },
    ],
  },

  { path: "*", element: <NotFound /> },
]);
