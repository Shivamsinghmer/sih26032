/**
 * The centre officer panel.
 *
 * The capacity screen is the one that matters: the engine runs here, in the
 * browser, on every keystroke — the same pure function the server will run when
 * the day is published. The officer sees the effect of one more truck before
 * anything is saved, and sees the same numbers the farmer will.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  computeCapacity, allocate, type Constraint, type QueueBookingDto, type CapacityDayDto,
} from "@mandi/shared";
import { Page, PageHeader, Card } from "../components/page.js";
import {
  Button, BookingStatusPill, EmptyState, ErrorNote, Pill, SkeletonCard,
  formatDateTime, formatQuintals, formatRupees, formatTime, stageLabel,
} from "../components/ui.js";
import {
  useAdvanceQueue, useCentreCapacity, useCentreQueue, useCentreToday, usePublishCapacity, useRecordLot,
} from "../lib/hooks.js";
import { useMe } from "../auth/session.js";

/** The officer's own centre. An admin has none, and sees a prompt instead. */
function useCentreId(): string | null {
  return useMe().officer?.centreId ?? null;
}

function NoCentre() {
  return (
    <Page>
      <PageHeader title="No centre assigned" />
      <EmptyState
        title="This account is not tied to a procurement centre"
        body="District admin accounts oversee every centre rather than operating one. Use the district overview."
      />
      <div className="mt-4"><Link to="/admin"><Button>District overview</Button></Link></div>
    </Page>
  );
}

/* ----------------------------------------------------------------- today */

export function CentreToday() {
  const centreId = useCentreId();
  const { data, isPending, isError, error, refetch } = useCentreToday(centreId);

  if (!centreId) return <NoCentre />;

  return (
    <Page>
      <PageHeader title={data?.centre.name ?? "Today"} lede="What this centre can take today, who is in the yard, and what is overdue." />

      {isPending && <div className="grid gap-4 md:grid-cols-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>}
      {isError && <ErrorNote error={error} onRetry={() => void refetch()} />}

      {data && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <p className="text-caption text-stone">Sellable today</p>
              {data.capacityDay ? (
                <>
                  <p className="mt-1 text-heading font-semibold tracking-[-0.02em]">
                    {formatQuintals(data.capacityDay.approvedQuintals ?? data.capacityDay.computedQuintals)}
                  </p>
                  {data.capacityDay.bindingConstraint && (
                    <p className="mt-2"><Pill tone="warn">Limited by {data.capacityDay.bindingConstraint.toLowerCase()}</Pill></p>
                  )}
                  {data.capacityDay.status !== "PUBLISHED" && (
                    <p className="mt-2 text-body-sm text-vermillion">Draft — farmers cannot book this day yet.</p>
                  )}
                </>
              ) : (
                // A missing day is the finding, not a zero to gloss over.
                <>
                  <p className="mt-1 text-heading-sm font-semibold text-vermillion">Not entered</p>
                  <p className="mt-2 text-body-sm text-graphite">No capacity has been costed for today, so nothing is bookable.</p>
                  <div className="mt-3"><Link to="/centre/capacity"><Button>Enter capacity</Button></Link></div>
                </>
              )}
            </Card>

            <Card>
              <p className="text-caption text-stone">In the yard today</p>
              <p className="mt-1 text-heading font-semibold tracking-[-0.02em]">{data.bookingsToday.length}</p>
              <p className="mt-2 text-body-sm text-graphite">
                {data.bookingsToday.filter((b) => b.status === "COMPLETED").length} completed ·{" "}
                {data.bookingsToday.filter((b) => b.status === "ARRIVED").length} waiting
              </p>
              <div className="mt-3"><Link to="/centre/queue"><Button variant="ghost">Queue board</Button></Link></div>
            </Card>

            <Card className={data.breachedLots.length > 0 ? "border-0 bg-coral text-pure-white" : ""}>
              <p className="text-caption opacity-70">Payments overdue</p>
              <p className="mt-1 text-heading font-semibold tracking-[-0.02em]">{data.breachedLots.length}</p>
              <p className="mt-2 text-body-sm opacity-80">{data.awaitingLift} lots still awaiting lift</p>
            </Card>
          </div>

          {data.breachedLots.length > 0 && (
            <Card className="mt-4">
              <h2 className="text-heading-sm font-semibold">Past the 72-hour norm</h2>
              <ul className="mt-3 divide-y divide-hairline">
                {data.breachedLots.map((lot) => (
                  <li key={lot.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="text-body font-medium">{lot.farmerName}</p>
                      <p className="text-body-sm text-stone">{lot.village} · {formatRupees(lot.amountPaise)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Pill tone="neutral">{stageLabel(lot.stage)}</Pill>
                      {/* The owner is the whole point — a delay with no office is a complaint. */}
                      <Pill tone="bad">{lot.hoursOverdue}h · {lot.owner}</Pill>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </Page>
  );
}

/* -------------------------------------------------------------- capacity */

const CONSTRAINT_LABEL: Record<Constraint, string> = {
  BARDANA: "Bardana",
  LABOUR: "Labour",
  WEIGHBRIDGE: "Weighbridge",
  YARD: "Yard space",
};

function tomorrowIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function CentreCapacity() {
  const centreId = useCentreId();
  const [date, setDate] = useState(tomorrowIso());
  const screen = useCentreCapacity(centreId, date);
  const publish = usePublishCapacity(centreId);

  const [form, setForm] = useState({
    bardanaBags: 0, labourGangs: 0, trucksAssigned: 0, weighbridgeHours: 9, openingBacklogQuintals: 0,
  });

  // Load whatever is already saved for the chosen day, so an officer edits the
  // day rather than retyping it.
  useEffect(() => {
    const day = screen.data?.capacityDay;
    if (day) {
      setForm({
        bardanaBags: day.bardanaBags,
        labourGangs: day.labourGangs,
        trucksAssigned: day.trucksAssigned,
        weighbridgeHours: day.weighbridgeHours,
        openingBacklogQuintals: day.openingBacklogQuintals,
      });
    }
  }, [screen.data?.capacityDay?.id, date]);

  const centre = screen.data?.centre;

  /**
   * The engine, live. Same pure function the server runs on publish — imported
   * from packages/shared precisely so the two cannot disagree.
   */
  const result = useMemo(() => {
    if (!centre) return null;
    return computeCapacity({
      ...form,
      weighbridgeCount: centre.weighbridgeCount,
      yardCapacityQuintals: centre.yardCapacityQuintals,
    });
  }, [form, centre]);

  const offered = result ? allocate(result.sellableQuintals).offeredQuintals : 0;
  const booked = screen.data?.booked.quintals ?? 0;
  // The number that decides whether publishing will move people.
  const willOverflow = booked > offered;

  if (!centreId) return <NoCentre />;

  return (
    <Page>
      <PageHeader
        title="Daily capacity"
        lede="Five numbers. The engine costs the day against each resource and takes the smallest — that is what can be sold."
      />

      {screen.isError && <ErrorNote error={screen.error} onRetry={() => void screen.refetch()} />}
      {screen.isPending && <SkeletonCard lines={5} />}

      {screen.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-heading-sm font-semibold">Today's ground conditions</h2>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-button border border-hairline bg-pure-white px-3 py-1.5 text-body-sm"
              />
            </div>

            <div className="mt-4 space-y-3">
              <NumberField label="Gunny bags on hand" hint="Each holds 50 kg" value={form.bardanaBags}
                onChange={(v) => setForm({ ...form, bardanaBags: v })} />
              <NumberField label="Labour gangs" hint="About 350 qtl per gang per shift" value={form.labourGangs}
                onChange={(v) => setForm({ ...form, labourGangs: v })} />
              <NumberField label="Trucks assigned" hint="Each lifts about 280 qtl, freeing yard space" value={form.trucksAssigned}
                onChange={(v) => setForm({ ...form, trucksAssigned: v })} />
              <NumberField label="Weighbridge hours" hint={`${centre?.weighbridgeCount ?? 1} bridge(s), ~12 min per lot`} value={form.weighbridgeHours}
                onChange={(v) => setForm({ ...form, weighbridgeHours: v })} step={0.5} />
              <NumberField label="Unlifted backlog (qtl)" hint="Yesterday's stock still on the floor" value={form.openingBacklogQuintals}
                onChange={(v) => setForm({ ...form, openingBacklogQuintals: v })} />
            </div>
          </Card>

          <Card>
            <h2 className="text-heading-sm font-semibold">What the day can take</h2>

            {result && (
              <>
                <p className="mt-3 text-display-sm font-semibold tracking-[-0.035em]">
                  {result.sellableQuintals.toLocaleString("en-IN")}
                  <span className="ml-2 text-body text-stone">quintals</span>
                </p>
                <p className="mt-1 text-body text-graphite">{result.explanation}</p>

                {/* Four bars on one scale. Only the binding one carries colour —
                    the shape of the chart is the diagnosis. */}
                <div className="mt-5 space-y-3">
                  {result.breakdown.map((line) => {
                    const max = Math.max(...result.breakdown.map((b) => b.quintals), 1);
                    const binding = line.constraint === result.bindingConstraint;
                    return (
                      <div key={line.constraint}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className={`text-body-sm ${binding ? "font-semibold text-ink-black" : "text-stone"}`}>
                            {CONSTRAINT_LABEL[line.constraint]}
                          </span>
                          <span className={`text-body-sm tabular-nums ${binding ? "font-semibold" : "text-stone"}`}>
                            {line.quintals.toLocaleString("en-IN")}
                          </span>
                        </div>
                        <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-black/5">
                          <div
                            className={`h-full rounded-full ${binding ? "bg-marigold" : "bg-black/15"}`}
                            style={{ width: `${Math.max(2, (line.quintals / max) * 100)}%` }}
                          />
                        </div>
                        <p className="mt-1 text-caption text-stone">{line.detail}</p>
                      </div>
                    );
                  })}
                </div>

                <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-hairline pt-4">
                  <div>
                    <dt className="text-caption text-stone">Offered as slots</dt>
                    <dd className="text-body font-medium">{formatQuintals(offered)}</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-stone">Already booked</dt>
                    <dd className="text-body font-medium">
                      {formatQuintals(booked)}{" "}
                      <span className="text-body-sm text-stone">({screen.data.booked.bookings})</span>
                    </dd>
                  </div>
                </dl>

                {/* Say the cost of the cut BEFORE it is made. */}
                {willOverflow && (
                  <p className="mt-4 rounded-small bg-coral/10 px-3 py-2 text-body-sm">
                    Publishing this will move farmers: {formatQuintals(booked)} is booked but only{" "}
                    {formatQuintals(offered)} can be offered. Everyone moved is told why, before they travel.
                  </p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    onClick={() => publish.mutate({ date, ...form, publish: true })}
                    disabled={publish.isPending}
                  >
                    {publish.isPending ? "Publishing…" : "Publish this day"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => publish.mutate({ date, ...form, publish: false })}
                    disabled={publish.isPending}
                  >
                    Save as draft
                  </Button>
                </div>

                {publish.isError && (
                  <p className="mt-3 text-body-sm text-vermillion">{publish.error.message}</p>
                )}

                {publish.isSuccess && (
                  <div className="mt-4 rounded-small bg-sky-tint px-3 py-3 text-body-sm">
                    <p className="font-medium">
                      {publish.data.published ? "Published." : "Saved as a draft — farmers cannot see it."}
                    </p>
                    {publish.data.reslotted.length > 0 ? (
                      <>
                        <p className="mt-1">
                          {publish.data.reslotted.length} farmer(s) re-slotted and notified:
                        </p>
                        <ul className="mt-1 list-disc pl-5">
                          {publish.data.reslotted.map((r) => <li key={r.bookingId}>{r.farmerName}</li>)}
                        </ul>
                      </>
                    ) : (
                      publish.data.published && <p className="mt-1">Everyone already booked still fits.</p>
                    )}
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      )}
    </Page>
  );
}

function NumberField({
  label, hint, value, onChange, step = 1,
}: { label: string; hint: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="block">
      <span className="block text-body-sm font-medium">{label}</span>
      <span className="block text-caption text-stone">{hint}</span>
      <input
        type="number"
        min={0}
        step={step}
        value={value}
        // The engine clamps NaN and negatives, so a half-typed value still
        // renders a number rather than breaking the chart mid-keystroke.
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-button border border-hairline bg-pure-white px-3 py-2 text-body tabular-nums"
      />
    </label>
  );
}

/* ----------------------------------------------------------- queue board */

export function CentreQueueBoard() {
  const centreId = useCentreId();
  const { data, isPending, isError, error, refetch } = useCentreQueue(centreId);
  const advance = useAdvanceQueue();
  const [quality, setQuality] = useState<QueueBookingDto | null>(null);

  if (!centreId) return <NoCentre />;

  return (
    <Page>
      <PageHeader title="Queue board" lede="Call the next token, record arrivals, and enter the quality check." />

      {isPending && <SkeletonCard lines={6} />}
      {isError && <ErrorNote error={error} onRetry={() => void refetch()} />}

      {data && (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label="Booked" value={String(data.stats.total)} />
            <Stat label="Served" value={String(data.stats.served)} />
            <Stat label="Waiting" value={String(data.stats.waiting)} />
            <Stat label="Being served" value={String(data.stats.inProgress)} />
            <Stat
              label="Observed pace"
              value={data.stats.observedMinutesPerLot ? `${data.stats.observedMinutesPerLot} min/lot` : "—"}
            />
          </dl>

          {data.bookings.length === 0 && (
            <EmptyState title="Nobody booked today" body="Publish a capacity day to make slots bookable." />
          )}

          <div className="space-y-2">
            {data.bookings.map((b) => (
              <Card key={b.id} className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-[12rem]">
                  <p className="text-body font-medium">
                    {b.tokenNumber !== null && <span className="mr-2 tabular-nums text-stone">#{b.tokenNumber}</span>}
                    {b.farmer.name}
                  </p>
                  <p className="text-body-sm text-stone">
                    {b.farmer.village} · {formatQuintals(b.quantityQuintals)} · {formatTime(b.slotStart)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <BookingStatusPill status={b.status} />
                  {(b.status === "BOOKED" || b.status === "RESLOTTED") && (
                    <>
                      <Button variant="ghost" onClick={() => advance.mutate({ bookingId: b.id, action: "ARRIVE" })}>Mark arrived</Button>
                      <Button variant="ghost" onClick={() => advance.mutate({ bookingId: b.id, action: "NO_SHOW" })}>No-show</Button>
                    </>
                  )}
                  {b.status === "ARRIVED" && (
                    <Button onClick={() => advance.mutate({ bookingId: b.id, action: "START" })}>Call next</Button>
                  )}
                  {b.status === "IN_PROGRESS" && (
                    <Button onClick={() => setQuality(b)}>Quality check</Button>
                  )}
                </div>
              </Card>
            ))}
          </div>

          {quality && <QualityCheck booking={quality} onDone={() => setQuality(null)} />}
        </>
      )}
    </Page>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface-card p-4">
      <dt className="text-caption text-stone">{label}</dt>
      <dd className="mt-1 text-heading-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * Moisture and weight in one step.
 *
 * A failing reading rejects the lot, re-slots the booking and notifies — so the
 * farmer learns the new date before leaving the yard rather than repeating the
 * trip next week.
 */
function QualityCheck({ booking, onDone }: { booking: QueueBookingDto; onDone: () => void }) {
  const record = useRecordLot();
  const [moisture, setMoisture] = useState("");
  const [net, setNet] = useState(String(booking.quantityQuintals));

  const m = Number(moisture);
  const n = Number(net);
  const valid = Number.isFinite(m) && m > 0 && Number.isFinite(n) && n > 0;
  const willFail = valid && m > 17;

  if (record.isSuccess) {
    return (
      <Card className="mt-4 border-0 bg-sky-tint">
        <p className="text-body font-medium">
          {record.data.qualityPass
            ? "Passed. J-form issued and the 72-hour payment clock has started."
            : "Rejected on moisture. The booking has been re-slotted and the farmer notified."}
        </p>
        <div className="mt-3"><Button onClick={onDone}>Back to the board</Button></div>
      </Card>
    );
  }

  return (
    <Card className="mt-4">
      <h2 className="text-heading-sm font-semibold">Quality check — {booking.farmer.name}</h2>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-caption text-stone">Moisture %</span>
          <input type="number" step={0.1} min={0} value={moisture} onChange={(e) => setMoisture(e.target.value)}
            className="mt-1 w-32 rounded-button border border-hairline px-3 py-2 text-body tabular-nums" placeholder="15.5" />
        </label>
        <label className="block">
          <span className="block text-caption text-stone">Net quintals</span>
          <input type="number" step={0.1} min={0} value={net} onChange={(e) => setNet(e.target.value)}
            className="mt-1 w-32 rounded-button border border-hairline px-3 py-2 text-body tabular-nums" />
        </label>
        <Button
          onClick={() => record.mutate({ bookingId: booking.id, moisturePercent: m, netQuintals: n, crop: "PADDY" })}
          disabled={!valid || record.isPending}
        >
          {record.isPending ? "Recording…" : "Record"}
        </Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>

      {/* The limit lives in SeasonConfig; 17% is what the API will apply to paddy. */}
      {willFail && (
        <p className="mt-3 rounded-small bg-coral/10 px-3 py-2 text-body-sm">
          Above the 17% limit for paddy. Recording this will reject the lot, re-slot the booking and
          notify the farmer with the new date.
        </p>
      )}
      {record.isError && <p className="mt-3 text-body-sm text-vermillion">{record.error.message}</p>}
    </Card>
  );
}
