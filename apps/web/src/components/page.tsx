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
