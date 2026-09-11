/**
 * The district admin panel.
 *
 * Two screens: every centre on one board, and the escalation queue. The
 * escalation queue is the one that has to be right — a breach with no named
 * office is just a complaint, which is exactly why existing dashboards surface
 * delays and nothing moves.
 */

import type { Constraint } from "@mandi/shared";
import { Page, PageHeader, Card } from "../components/page.js";
import {
  Button, EmptyState, ErrorNote, Pill, SkeletonCard,
  formatDateTime, formatQuintals, formatRupees, stageLabel,
} from "../components/ui.js";
import { useAdminOverview, useEscalations, useAdvanceStage } from "../lib/hooks.js";

const CONSTRAINT_LABEL: Record<Constraint, string> = {
  BARDANA: "Bardana",
  LABOUR: "Labour",
  WEIGHBRIDGE: "Weighbridge",
  YARD: "Yard space",
};

export function AdminOverviewScreen() {
  const { data, isPending, isError, error, refetch } = useAdminOverview();

  return (
    <Page>
      <PageHeader
        title="District overview"
        lede="Every centre, what each can take today, and what is overdue across all of them."
      />

      {isPending && <div className="grid gap-4 md:grid-cols-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>}
      {isError && <ErrorNote error={error} onRetry={() => void refetch()} />}

      {data && (
        <>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Centres" value={String(data.kpis.centres)} />
            <Kpi label="Farmers" value={data.kpis.farmers.toLocaleString("en-IN")} />
            <Kpi label="Booked today" value={String(data.kpis.bookingsToday)} />
            <Kpi label="Served today" value={String(data.kpis.servedToday)} />
            {/* Both of these are problems, so they are coloured as problems. */}
            <Kpi label="Payments overdue" value={String(data.kpis.breachedLots)} tone={data.kpis.breachedLots > 0 ? "bad" : "neutral"} />
            <Kpi label="Not published" value={String(data.kpis.centresNotPublished)} tone={data.kpis.centresNotPublished > 0 ? "warn" : "neutral"} />
          </dl>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="space-y-3 lg:col-span-2">
              {data.centres.map((row) => (
                <Card key={row.centre.id} className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-body font-medium">{row.centre.name}</p>
                    <p className="text-body-sm text-stone">
                      {row.centre.village} · {row.servedToday} of {row.bookingsToday} served today
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {row.published ? (
                      <>
                        <span className="text-body font-medium tabular-nums">
                          {formatQuintals(row.sellableQuintals)}
                        </span>
                        {row.bindingConstraint && (
                          <Pill tone="warn">{CONSTRAINT_LABEL[row.bindingConstraint]}</Pill>
                        )}
                      </>
                    ) : (
                      // The gap itself is the finding the admin screen exists to surface.
                      <Pill tone="bad">Capacity not published</Pill>
                    )}
                    {row.breachedLots > 0 && <Pill tone="bad">{row.breachedLots} overdue</Pill>}
                    {row.awaitingLift > 0 && <Pill tone="neutral">{row.awaitingLift} awaiting lift</Pill>}
                  </div>
                </Card>
              ))}
            </div>

            <Card>
              <h2 className="text-heading-sm font-semibold">What limits this district</h2>
              <p className="mt-2 text-body-sm text-graphite">
                Across every published day. This is the question to answer before next season's
                tendering — it names the resource to buy, not just the shortfall.
              </p>
              <ul className="mt-4 space-y-3">
                {data.constraintHistory.length === 0 && (
                  <li className="text-body-sm text-stone">No published days yet.</li>
                )}
                {(() => {
                  const max = Math.max(...data.constraintHistory.map((c) => c.days), 1);
                  return data.constraintHistory
                    .slice()
                    .sort((a, b) => b.days - a.days)
                    .map((c) => (
                      <li key={c.constraint ?? "none"}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-body-sm">
                            {c.constraint ? CONSTRAINT_LABEL[c.constraint] : "Unknown"}
                          </span>
                          <span className="text-body-sm tabular-nums text-stone">
                            {c.days} day{c.days === 1 ? "" : "s"}
                          </span>
                        </div>
                        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-black/5">
                          <div className="h-full rounded-full bg-notion-blue" style={{ width: `${(c.days / max) * 100}%` }} />
                        </div>
                      </li>
                    ));
                })()}
              </ul>
            </Card>
          </div>
        </>
      )}
    </Page>
  );
}

function Kpi({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "warn" | "bad" }) {
  const bg = tone === "bad" ? "bg-coral text-pure-white" : tone === "warn" ? "bg-marigold" : "surface-card";
  const border = tone === "neutral" ? "" : "border-0";
  return (
    <div className={`rounded-card p-4 ${bg} ${border}`}>
      <dt className="text-caption opacity-70">{label}</dt>
      <dd className="mt-1 text-heading-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function AdminEscalations() {
  const { data, isPending, isError, error, refetch } = useEscalations();
  const advance = useAdvanceStage();

  return (
    <Page>
      <PageHeader
        title="Escalations"
        lede="Every lot past the 72-hour payment norm, with the office accountable for the stage it is stuck at."
      />

      {isPending && <div className="space-y-4"><SkeletonCard /><SkeletonCard /></div>}
      {isError && <ErrorNote error={error} onRetry={() => void refetch()} />}

      {data?.length === 0 && (
        <EmptyState title="Nothing overdue" body="Every lot with a J-form is inside the 72-hour norm." />
      )}

      <div className="space-y-3">
        {data?.map((row) => (
          <Card key={row.lotId}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-body font-medium">{row.farmer.name}</p>
                <p className="text-body-sm text-stone">
                  {row.farmer.village} · {row.centre.name} · {row.farmer.phone}
                </p>
              </div>
              <div className="text-right">
                <p className="text-heading-sm font-semibold">{formatRupees(row.amountPaise)}</p>
                <p className="text-body-sm text-stone">{row.jFormNumber}</p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Pill tone="neutral">{stageLabel(row.stage)}</Pill>
              <Pill tone="bad">{row.hoursOverdue}h overdue</Pill>
              {/* The named office. Without it this screen is a list of complaints. */}
              <Pill tone="warn">Owner: {row.owner}</Pill>
            </div>

            <p className="mt-3 text-body-sm text-graphite">
              J-form {row.jFormIssuedAt ? formatDateTime(row.jFormIssuedAt) : "—"}
              {row.slaDueAt && ` · was due ${formatDateTime(row.slaDueAt)}`}
            </p>

            {/* Recording the milestone that unblocks it, from the screen that
                surfaced the breach. The stage is still derived server-side. */}
            <div className="mt-3 flex flex-wrap gap-2">
              {row.stage === "J_FORM_ISSUED" && (
                <Button variant="ghost" onClick={() => advance.mutate({ lotId: row.lotId, stage: "LIFTED" })}>
                  Record lifted
                </Button>
              )}
              {row.stage === "LIFTED" && (
                <Button variant="ghost" onClick={() => advance.mutate({ lotId: row.lotId, stage: "AGENCY_ACKNOWLEDGED" })}>
                  Record agency acknowledgement
                </Button>
              )}
              {row.stage === "AGENCY_ACKNOWLEDGED" && (
                <Button variant="ghost" onClick={() => advance.mutate({ lotId: row.lotId, stage: "SENT_FOR_PAYMENT" })}>
                  Record sent for payment
                </Button>
              )}
              {row.stage === "SENT_FOR_PAYMENT" && (
                <Button variant="ghost" onClick={() => advance.mutate({ lotId: row.lotId, stage: "CREDITED" })}>
                  Record credited
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>

      {advance.isError && (
        <p className="mt-3 text-body-sm text-vermillion">{advance.error.message}</p>
      )}
    </Page>
  );
}
