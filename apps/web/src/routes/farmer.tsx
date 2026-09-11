/**
 * The farmer panel.
 *
 * Four screens: dashboard, booking, live queue, payments. Every one of them
 * reads server-derived values rather than recomputing them — the payment stage
 * and the ETA in particular.
 */

import { useState } from "react";
import { Link } from "react-router";
import type { Crop, LotDto, NextBookingDto, SlotDay } from "@mandi/shared";
import { Page, PageHeader, Card } from "../components/page.js";
import {
  Button, BookingStatusPill, EmptyState, ErrorNote, PaymentTracker, Pill, SkeletonCard,
  formatDate, formatDateTime, formatMinutes, formatQuintals, formatRupees, stageLabel,
} from "../components/ui.js";
import {
  useCentres, useCreateBooking, useFarmerDashboard, useFarmerLots, useQueueContext, useSlots,
} from "../lib/hooks.js";
import { useMe } from "../auth/session.js";

/* ------------------------------------------------------------------ dashboard */

export function FarmerDashboard() {
  const me = useMe();
  const { data, isPending, isError, error, refetch } = useFarmerDashboard();

  return (
    <Page>
      <PageHeader
        title={`Namaste, ${me.farmer?.name ?? "farmer"}`}
        lede={[me.farmer?.village, me.farmer?.district].filter(Boolean).join(", ")}
      />

      {isPending && <div className="grid gap-4 md:grid-cols-2"><SkeletonCard /><SkeletonCard /></div>}
      {isError && <ErrorNote error={error} onRetry={() => void refetch()} />}

      {data && (
        <div className="grid gap-4 md:grid-cols-2">
          <NextBookingCard booking={data.nextBooking} />
          <LatestPaymentCard lot={data.latestLot} />
        </div>
      )}

      {/* Moisture guidance before travel, not after a rejected trip. */}
      <Card className="mt-4 border-0 bg-marigold">
        <h2 className="text-heading-sm font-semibold">Before you load the trolley</h2>
        <p className="mt-2 max-w-prose text-body">
          Paddy is accepted up to <strong>17% moisture</strong>. Above that the lot is rejected and you
          lose the slot — so dry the grain fully and check it before setting out.
        </p>
      </Card>
    </Page>
  );
}

function NextBookingCard({ booking }: { booking: NextBookingDto | null }) {
  if (!booking) {
    return (
      <Card>
        <h2 className="text-heading-sm font-semibold">No slot booked</h2>
        <p className="mt-2 text-body text-graphite">Book one when you are ready to sell.</p>
        <div className="mt-4">
          <Link to="/farmer/book">
            <Button>Book a slot</Button>
          </Link>
        </div>
      </Card>
    );
  }

  const moved = booking.status === "RESLOTTED";

  return (
    <Card className={moved ? "border-0 bg-marigold" : ""}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-heading-sm font-semibold">Your next slot</h2>
        <BookingStatusPill status={booking.status} />
      </div>

      {/* A moved slot leads with the reason and an instruction, not the time. */}
      {moved && booking.reslotReason && (
        <p className="mt-3 text-body font-medium">{booking.reslotReason}</p>
      )}

      <p className="mt-3 text-heading-sm font-semibold">{formatDateTime(booking.slotStart)}</p>
      <p className="text-body text-graphite">
        {booking.centre.name} · {formatQuintals(booking.quantityQuintals)}
      </p>

      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
        <div>
          <dt className="text-caption text-stone">Gate pass</dt>
          <dd className="font-mono text-body font-medium">{booking.gatePassCode}</dd>
        </div>
        {booking.tokenNumber !== null && (
          <div>
            <dt className="text-caption text-stone">Token</dt>
            <dd className="text-body font-medium">#{booking.tokenNumber}</dd>
          </div>
        )}
      </dl>

      <div className="mt-4">
        <Link to="/farmer/queue">
          <Button variant="ghost">See the queue</Button>
        </Link>
      </div>
    </Card>
  );
}

function LatestPaymentCard({ lot }: { lot: LotDto | null }) {
  if (!lot) {
    return (
      <Card>
        <h2 className="text-heading-sm font-semibold">No payment pending</h2>
        <p className="mt-2 text-body text-graphite">
          Once your lot is weighed and a J-form is issued, the 72-hour payment clock starts here.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-heading-sm font-semibold">Latest payment</h2>
        {lot.breached && <Pill tone="bad">Overdue</Pill>}
      </div>
      <p className="mt-3 text-heading-sm font-semibold">{formatRupees(lot.amountPaise)}</p>
      <p className="text-body text-graphite">{lot.jFormNumber ?? "J-form not yet issued"}</p>
      <div className="mt-4">
        <PaymentTracker
          stage={lot.stage}
          breached={lot.breached}
          owner={lot.owner}
          hoursOverdue={lot.hoursOverdue}
        />
      </div>
      <div className="mt-4">
        <Link to="/farmer/payments">
          <Button variant="ghost">All payments</Button>
        </Link>
      </div>
    </Card>
  );
}

/* --------------------------------------------------------------------- queue */

export function FarmerQueue() {
  const { data, isPending, isError, error, refetch, isFetching } = useQueueContext();

  return (
    <Page>
      <PageHeader
        title="Live queue"
        lede="The wait is estimated from what this centre has actually processed today, so it corrects itself."
      />

      {isPending && <SkeletonCard lines={4} />}
      {isError && <ErrorNote error={error} onRetry={() => void refetch()} />}

      {data && !data.booking && (
        <EmptyState title="No active booking" body="Book a slot to follow the queue on the day." />
      )}

      {data?.booking && data.queue && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="md:col-span-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-caption text-stone">Your token</p>
                <p className="text-display-sm font-semibold tracking-[-0.035em]">
                  {data.booking.tokenNumber !== null ? `#${data.booking.tokenNumber}` : "—"}
                </p>
              </div>
              <BookingStatusPill status={data.booking.status} />
            </div>

            <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat label="Now serving" value={data.queue.nowServingToken !== null ? `#${data.queue.nowServingToken}` : "Not started"} />
              <Stat label="Ahead of you" value={String(data.queue.ahead)} />
              <Stat label="Estimated wait" value={formatMinutes(data.queue.etaMinutes)} />
            </dl>

            <p className="mt-6 text-body-sm text-stone">
              {data.queue.etaFromObservedRate
                ? `Based on today's pace at this centre — about ${data.queue.observedMinutesPerLot} minutes per lot, from ${data.queue.servedToday} lots served so far.`
                : "Based on a planning figure. The estimate will sharpen once the centre has served a few lots today."}
              {isFetching && " · refreshing"}
            </p>
          </Card>

          <Card>
            <h2 className="text-heading-sm font-semibold">Gate pass</h2>
            <p className="mt-2 font-mono text-heading-sm font-semibold">{data.booking.gatePassCode}</p>
            <p className="mt-2 text-body-sm text-graphite">
              Show this at the gate. {data.booking.centre.name}, {formatDateTime(data.booking.slotStart)}.
            </p>
          </Card>
        </div>
      )}
    </Page>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption text-stone">{label}</dt>
      <dd className="mt-1 text-heading-sm font-semibold">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ payments */

export function FarmerPayments() {
  const { data, isPending, isError, error, refetch } = useFarmerLots();

  return (
    <Page>
      <PageHeader
        title="Payments"
        lede="Every stage is recorded from what actually happened, and each carries the office accountable for it."
      />

      {isPending && <div className="space-y-4"><SkeletonCard /><SkeletonCard /></div>}
      {isError && <ErrorNote error={error} onRetry={() => void refetch()} />}

      {data?.length === 0 && (
        <EmptyState title="Nothing sold yet" body="Payments appear here once a lot has been weighed and a J-form issued." />
      )}

      <div className="space-y-4">
        {data?.map((lot) => (
          <Card key={lot.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-heading-sm font-semibold">{formatRupees(lot.amountPaise)}</p>
                <p className="text-body text-graphite">
                  {lot.centre?.name}
                  {lot.netQuintals !== null && ` · ${formatQuintals(lot.netQuintals)}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {lot.breached && <Pill tone="bad">Overdue</Pill>}
                <Pill tone="neutral">{stageLabel(lot.stage)}</Pill>
              </div>
            </div>

            {/* A rejected lot never reached a J-form; show why instead of an empty tracker. */}
            {lot.qualityPass === false ? (
              <p className="mt-4 rounded-small bg-coral/10 px-3 py-2 text-body-sm">
                {lot.rejectionReason ?? "Rejected at the quality check."}
              </p>
            ) : (
              <div className="mt-4">
                <PaymentTracker
                  stage={lot.stage}
                  breached={lot.breached}
                  owner={lot.owner}
                  hoursOverdue={lot.hoursOverdue}
                />
              </div>
            )}

            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-body-sm">
              {lot.jFormNumber && (
                <div>
                  <dt className="text-caption text-stone">J-form</dt>
                  <dd className="font-mono">{lot.jFormNumber}</dd>
                </div>
              )}
              {lot.jFormIssuedAt && (
                <div>
                  <dt className="text-caption text-stone">Issued</dt>
                  <dd>{formatDateTime(lot.jFormIssuedAt)}</dd>
                </div>
              )}
              {lot.slaDueAt && !lot.creditedAt && (
                <div>
                  <dt className="text-caption text-stone">Due by</dt>
                  <dd>{formatDateTime(lot.slaDueAt)}</dd>
                </div>
              )}
              {lot.creditedAt && (
                <div>
                  <dt className="text-caption text-stone">Credited</dt>
                  <dd>{formatDateTime(lot.creditedAt)}</dd>
                </div>
              )}
            </dl>
          </Card>
        ))}
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------------- booking */

export function FarmerBook() {
  const centres = useCentres();
  const [centreId, setCentreId] = useState<string | null>(null);
  const [day, setDay] = useState<SlotDay | null>(null);
  const [quantity, setQuantity] = useState("");
  const slots = useSlots(centreId);
  const create = useCreateBooking();

  const qty = Number(quantity);
  const qtyValid = Number.isFinite(qty) && qty > 0;
  // The day list already excludes days that cannot fit anything, but the
  // farmer's own quantity still has to fit in what is left.
  const fits = day ? qtyValid && qty <= day.remainingQuintals : false;

  function submit() {
    if (!centreId || !day || !fits) return;
    const slotStart = new Date(day.date);
    slotStart.setUTCHours(day.openHour, 0, 0, 0);
    create.mutate({
      centreId,
      slotStart: slotStart.toISOString(),
      quantityQuintals: qty,
      crop: "PADDY" as Crop,
    });
  }

  if (create.isSuccess) {
    return (
      <Page>
        <PageHeader title="Slot confirmed" />
        <Card className="border-0 bg-sky-tint">
          <p className="text-body">Your gate pass is</p>
          <p className="mt-1 font-mono text-heading-sm font-semibold">{create.data.booking.gatePassCode}</p>
          <p className="mt-3 text-body text-graphite">
            We have sent you the details. If capacity at the centre changes before your slot, you will be
            told and moved — <strong>before</strong> you travel.
          </p>
          <div className="mt-4 flex gap-2">
            <Link to="/farmer"><Button>Back to dashboard</Button></Link>
            <Link to="/farmer/queue"><Button variant="ghost">See the queue</Button></Link>
          </div>
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Book a slot"
        lede="Only days the centre can actually handle are offered. A day that cannot take your quantity is not shown."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-heading-sm font-semibold">1 · Choose a centre</h2>
          {centres.isPending && <p className="mt-3 text-body text-stone">Loading centres…</p>}
          {centres.isError && <p className="mt-3 text-body text-vermillion">{centres.error.message}</p>}
          <div className="mt-3 space-y-2">
            {centres.data?.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { setCentreId(c.id); setDay(null); }}
                className={`transition-notion block w-full rounded-button border px-4 py-3 text-left ${
                  centreId === c.id ? "border-notion-blue bg-sky-tint" : "border-hairline hover:bg-paper-warmth"
                }`}
              >
                <span className="block text-body font-medium">{c.name}</span>
                <span className="block text-body-sm text-stone">{c.village}, {c.district}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="text-heading-sm font-semibold">2 · Choose a day</h2>

          {!centreId && <p className="mt-3 text-body text-stone">Choose a centre first.</p>}
          {centreId && slots.isPending && <p className="mt-3 text-body text-stone">Checking what each day can take…</p>}
          {slots.isError && <p className="mt-3 text-body text-vermillion">{slots.error.message}</p>}

          {slots.data?.days.length === 0 && (
            <p className="mt-3 text-body text-graphite">
              No day at this centre can take a booking in the next week. That is the centre's real
              capacity, not a system error — try another centre.
            </p>
          )}

          <div className="mt-3 space-y-2">
            {slots.data?.days.map((d) => (
              <button
                key={d.capacityDayId}
                type="button"
                onClick={() => setDay(d)}
                className={`transition-notion block w-full rounded-button border px-4 py-3 text-left ${
                  day?.capacityDayId === d.capacityDayId ? "border-notion-blue bg-sky-tint" : "border-hairline hover:bg-paper-warmth"
                }`}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-body font-medium">{formatDate(d.date)}</span>
                  <span className="text-body-sm text-stone">{formatQuintals(d.remainingQuintals)} left</span>
                </span>
                {/* Naming the constraint is what makes a small number credible. */}
                {d.bindingConstraint && (
                  <span className="mt-1 block text-caption text-stone">
                    Limited today by {d.bindingConstraint.toLowerCase()}
                  </span>
                )}
              </button>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <h2 className="text-heading-sm font-semibold">3 · How much are you bringing?</h2>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-caption text-stone">Quantity in quintals</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={0.1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="mt-1 w-40 rounded-button border border-hairline bg-pure-white px-3 py-2 text-body"
              placeholder="42.5"
            />
          </label>
          <Button onClick={submit} disabled={!fits || create.isPending}>
            {create.isPending ? "Booking…" : "Confirm booking"}
          </Button>
        </div>

        {slots.data && !slots.data.landVerified && (
          <p className="mt-3 text-body-sm text-graphite">
            Your land record is not verified yet, so no seasonal cap applies. A centre officer can attest it.
          </p>
        )}
        {day && qtyValid && !fits && (
          <p className="mt-3 text-body-sm text-vermillion">
            That day has {formatQuintals(day.remainingQuintals)} left. Reduce the quantity or choose another day.
          </p>
        )}
        {/* 409 means capacity moved underneath the request; the message names what changed. */}
        {create.isError && (
          <p className="mt-3 rounded-small bg-coral/10 px-3 py-2 text-body-sm">
            {create.error.message}
            {create.error.isConflict && " The days above have been refreshed."}
          </p>
        )}
      </Card>
    </Page>
  );
}
