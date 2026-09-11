/**
 * Sign-in and sign-up.
 *
 * Sign-in is by phone number + OTP, which is what farmers actually have.
 * With no Clerk key in the bundle these pages explain that rather than
 * rendering a widget that cannot work.
 */

import { SignIn, SignUp } from "@clerk/clerk-react";
import { Link } from "react-router";
import { clerkConfigured } from "../auth/provider.js";

function AuthShell({ children }: { children: React.ReactNode }) {
  // Deliberately composed like the onboarding pages: centred, no panel nav,
  // because every dashboard link would be dead until the gates open.
  return (
    <main className="grid min-h-dvh place-content-center justify-items-center gap-6 px-6 py-16">
      <Link to="/" className="text-heading-sm font-semibold tracking-[-0.011em]">
        Mandi<span className="text-notion-blue">Queue</span>
      </Link>
      {children}
    </main>
  );
}

function NoClerk() {
  return (
    <div className="surface-card max-w-prose p-card text-center">
      <h1 className="text-heading-sm font-semibold">Sign-in is not configured</h1>
      <p className="mt-2 text-body text-graphite">
        This build carries no Clerk publishable key, so there is no sign-in widget to show. If the
        API is also running without its secret key, every panel is open already — open one from the{" "}
        <Link to="/" className="text-notion-blue underline">
          home page
        </Link>
        .
      </p>
    </div>
  );
}

export function SignInPage() {
  if (!clerkConfigured) return <AuthShell><NoClerk /></AuthShell>;
  return (
    <AuthShell>
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" forceRedirectUrl="/" />
    </AuthShell>
  );
}

export function SignUpPage() {
  if (!clerkConfigured) return <AuthShell><NoClerk /></AuthShell>;
  return (
    <AuthShell>
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" forceRedirectUrl="/onboarding" />
    </AuthShell>
  );
}
