/** The landing page and panel chooser. The only route with no session. */

import { Link } from "react-router";
import { useMeQuery } from "../auth/session.js";
import { homeFor } from "../auth/session.js";

export function Landing() {
  // Unauthenticated is a perfectly good answer here, so failures are ignored
  // rather than surfaced — this page works signed out.
  const { data: me } = useMeQuery();

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6">
      <section className="py-section">
        <p className="text-caption font-medium tracking-[0.01em] text-stone uppercase">
          Ministry of Consumer Affairs, Food &amp; Public Distribution
        </p>

        <h1 className="mt-6 max-w-[18ch] text-display-sm font-semibold tracking-[-0.035em] sm:text-display">
          Sell your crop without{" "}
          <span className="rounded-full bg-marigold px-6 py-2">sleeping</span> at the mandi.
        </h1>

        <p className="mt-8 max-w-prose font-lyon-text text-[18px] leading-[1.56] text-graphite">
          Slots are issued only against what the centre can physically handle that day — bags,
          labour, weighing time and yard space. If that changes, you are told before you travel.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          {me?.role ? (
            <Link
              to={homeFor(me.role)}
              className="transition-notion rounded-button bg-notion-blue px-[15px] py-1.5 text-body-sm font-medium text-pure-white hover:opacity-90"
            >
              Open your panel
            </Link>
          ) : (
            <Link
              to="/sign-in"
              className="transition-notion rounded-button bg-notion-blue px-[15px] py-1.5 text-body-sm font-medium text-pure-white hover:opacity-90"
            >
              Sign in with your phone
            </Link>
          )}
          <a
            href="https://github.com/Shivamsinghmer/sih26032"
            className="transition-notion rounded-button bg-sky-tint px-[15px] py-1.5 text-body-sm font-medium text-notion-blue hover:opacity-90"
          >
            How it works
          </a>
        </div>
      </section>

      <section className="grid gap-4 pb-section md:grid-cols-3">
        <Panel
          tone="bg-pure-white"
          title="Farmer"
          body="Book a slot, watch the queue move, carry a digital gate pass, and follow the payment to your bank."
        />
        <Panel
          tone="bg-sky-tint"
          title="Centre officer"
          body="Enter five numbers once a day. See what today can actually absorb, and which resource is the limit."
        />
        <Panel
          tone="bg-midnight-ink text-pure-white"
          title="District admin"
          body="Every centre on one board, with payment breaches attributed to the office that owns them."
        />
      </section>
    </main>
  );
}

function Panel({ tone, title, body }: { tone: string; title: string; body: string }) {
  // Accent cards paint the canvas; they carry no border, unlike white cards.
  const bordered = tone.includes("pure-white") ? "border border-hairline" : "";
  return (
    <article className={`rounded-card p-card ${tone} ${bordered}`}>
      <h2 className="text-heading-sm font-semibold tracking-[-0.011em]">{title}</h2>
      <p className="mt-2 text-body opacity-80">{body}</p>
    </article>
  );
}
