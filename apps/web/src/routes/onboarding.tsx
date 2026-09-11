/**
 * The registration gates.
 *
 * Registration is a continuation of signing up, not a section of the dashboard,
 * so this layout composes like the sign-in pages — centred, no panel nav. It
 * keeps a way out, because with the gate mandatory that is the only escape for
 * someone who cannot finish right now.
 */

import { Link, Navigate, Outlet } from "react-router";
import { useMe, homeFor } from "../auth/session.js";
import { Card } from "../components/page.js";

export function OnboardingLayout() {
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-[560px] content-center gap-6 px-6 py-16">
      <Link to="/" className="text-heading-sm font-semibold tracking-[-0.011em]">
        Mandi<span className="text-notion-blue">Queue</span>
      </Link>
      <Outlet />
    </main>
  );
}

export function OnboardingProfile() {
  const me = useMe();

  // Already past this gate: do not make them fill it again.
  if (me.gates.hasProfile) {
    return <Navigate to={me.gates.aadhaarVerified ? homeFor(me.role) : "/onboarding/verify"} replace />;
  }

  return (
    <Card>
      <p className="text-caption font-medium uppercase tracking-[0.01em] text-stone">Step 1 of 2</p>
      <h1 className="mt-2 text-heading-sm font-semibold">Tell us where you farm</h1>
      <p className="mt-2 text-body text-graphite">
        Your phone number comes from the account you just verified. The form itself is step 5 — it
        will post to <code className="rounded-small bg-paper-warmth px-1.5 py-0.5 text-body-sm">POST /onboarding</code>,
        which creates the profile and grants the farmer role.
      </p>
    </Card>
  );
}

export function OnboardingVerify() {
  const me = useMe();

  if (!me.gates.hasProfile) return <Navigate to="/onboarding" replace />;
  if (me.gates.aadhaarVerified) return <Navigate to={homeFor(me.role)} replace />;

  return (
    <Card>
      <p className="text-caption font-medium uppercase tracking-[0.01em] text-stone">Step 2 of 2</p>
      <h1 className="mt-2 text-heading-sm font-semibold">Scan the QR on your Aadhaar card</h1>
      <p className="mt-2 text-body text-graphite">
        The scan is checked on our server against UIDAI's public certificate. Nothing is sent to any
        government system, and your Aadhaar number is never stored — the QR does not contain one.
      </p>
      <p className="mt-4 text-body-sm text-stone">
        The scanner is step 5. It will post the QR's digit string to{" "}
        <code className="rounded-small bg-paper-warmth px-1.5 py-0.5 text-body-sm">POST /verify/aadhaar</code>.
      </p>
    </Card>
  );
}
