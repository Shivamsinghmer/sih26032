/** Shared page furniture: the centred 1440px column and a section heading. */

import type { ReactNode } from "react";

export function Page({ children }: { children: ReactNode }) {
  return <main className="mx-auto w-full max-w-[1440px] px-6 py-10">{children}</main>;
}

export function PageHeader({ title, lede }: { title: string; lede?: string }) {
  return (
    <div className="mb-8">
      <h1 className="text-heading font-semibold tracking-[-0.02em]">{title}</h1>
      {lede && <p className="mt-2 max-w-prose text-body text-graphite">{lede}</p>}
    </div>
  );
}

/** The hairline card. No shadow — that is the system's signature. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`surface-card p-card ${className}`}>{children}</section>;
}

/**
 * Stands in for a panel that step 5 will build. Named honestly rather than
 * rendered as fake data, so nobody demos a screen that does nothing.
 */
export function NotBuiltYet({ what, endpoint }: { what: string; endpoint: string }) {
  return (
    <Card className="border-dashed">
      <h2 className="text-heading-sm font-semibold">{what}</h2>
      <p className="mt-2 text-body text-graphite">
        Not built yet. The API endpoint it will read is{" "}
        <code className="rounded-small bg-paper-warmth px-1.5 py-0.5 text-body-sm">{endpoint}</code>.
      </p>
    </Card>
  );
}
