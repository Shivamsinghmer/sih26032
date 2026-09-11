/**
 * The 64px fixed nav from docs/design.md.
 *
 * Nav items are muted (#000 at 54%) and darken to full alpha on hover — never
 * an underline. The demo-mode badge reads `/me`, which is the API's own answer,
 * so nobody can mistake demo mode for real auth by looking at the page.
 */

import { NavLink } from "react-router";
import type { MeResponse } from "@mandi/shared";
import { ConnectionBadge } from "../lib/realtime.js";

export interface NavItem {
  to: string;
  label: string;
}

export function PanelNav({ me, items }: { me: MeResponse; items: NavItem[] }) {
  return (
    <header className="sticky top-0 z-10 h-16 border-b border-hairline bg-pure-white/95 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-[1440px] items-center gap-1 px-6">
        <NavLink to="/" className="mr-4 text-heading-sm font-semibold tracking-[-0.011em]">
          Mandi<span className="text-notion-blue">Queue</span>
        </NavLink>

        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end
            className={({ isActive }) =>
              [
                "transition-notion rounded-button px-4 py-3 text-body-sm font-medium",
                isActive ? "text-ink-black" : "text-ink-black/54 hover:text-ink-black",
              ].join(" ")
            }
          >
            {item.label}
          </NavLink>
        ))}

        <div className="ml-auto flex items-center gap-3">
          <ConnectionBadge />
          {me.demoMode && (
            <span
              className="rounded-full bg-marigold px-3 py-1 text-caption font-medium text-ink-black"
              title="The API has no Clerk secret key, so authentication is off and every panel is open."
            >
              demo mode
            </span>
          )}
          <span className="text-body-sm text-stone">
            {me.farmer?.name ?? me.officer?.name ?? "Signed in"}
          </span>
        </div>
      </nav>
    </header>
  );
}
