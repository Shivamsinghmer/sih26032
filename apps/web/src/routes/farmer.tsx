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
import { useT } from "../lib/i18n.js";

/* ------------------------------------------------------------------ dashboard */

export function FarmerDashboard() {
  const me = useMe();
  const { t } = useT();
  const { data, isPending, isError, error, refetch } = useFarmerDashboard();

  return (
    <Page>
      <PageHeader
        title={t("dash.greeting", { name: me.farmer?.name ?? "" })}
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
        <h2 className="text-heading-sm font-semibold">{t("dash.moistureTitle")}</h2>
        <p className="mt-2 max-w-prose text-body">{t("dash.moistureBody")}</p>
      </Card>
    </Page>
  );
}

function NextBookingCard({ booking }: { booking: NextBookingDto | null }) {
  const { t } = useT();
  if (!booking) {
    return (
      <Card>
        <h2 className="text-heading-sm font-semibold">{t("dash.noBooking")}</h2>
        <p className="mt-2 text-body text-graphite">{t("dash.noBookingBody")}</p>
        <div className="mt-4">
          <Link to="/farmer/book">
            <Button>{t("nav.book")}</Button>
          </Link>
        </div>
      </Card>
    );
  }

  const moved = booking.status === "RESLOTTED";

  return (
    <Card className={moved ? "border-0 bg-marigold" : ""}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-heading-sm font-semibold">{t("dash.nextSlot")}</h2>
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
          <dt className="text-caption text-stone">{t("dash.gatePass")}</dt>
          <dd className="font-mono text-body font-medium">{booking.gatePassCode}</dd>
        </div>
        {booking.tokenNumber !== null && (
          <div>
            <dt className="text-caption text-stone">{t("dash.token")}</dt>
            <dd className="text-body font-medium">#{booking.tokenNumber}</dd>
          </div>
        )}
      </dl>

      <div className="mt-4">
        <Link to="/farmer/queue">
          <Button variant="ghost">{t("dash.seeQueue")}</Button>
        </Link>
      </div>
    </Card>
  );
}

function LatestPaymentCard({ lot }: { lot: LotDto | null }) {
  const { t } = useT();
  if (!lot) {
    return (
      <Card>
        <h2 className="text-heading-sm font-semibold">{t("dash.noPayment")}</h2>
        <p className="mt-2 text-body text-graphite">{t("dash.noPaymentBody")}</p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-heading-sm font-semibold">{t("dash.latestPayment")}</h2>
        {lot.breached && <Pill tone="bad">{t("pay.overdue")}</Pill>}
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
          <Button variant="ghost">{t("dash.allPayments")}</Button>
        </Link>
      </div>
    </Card>
  );
}

/* --------------------------------------------------------------------- queue */

export function FarmerQueue() {
  const { t } = useT();
  const { data, isPending, isError, error, refetch, isFetching } = useQueueContext();

  return (
    <Page>
      <PageHeader
        title={t("queue.title")}
        lede={t("queue.lede")}
      />

      {isPending && <SkeletonCard lines={4} />}
      {isError && <ErrorNote error={error} onRetry={() => void refetch()} />}

      {data && !data.booking && (
        <EmptyState title={t("queue.noBooking")} body={t("queue.noBookingBody")} />
      )}

      {data?.booking && data.queue && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="md:col-span-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-caption text-stone">{t("queue.yourToken")}</p>
                <p className="text-display-sm font-semibold tracking-[-0.035em]">
                  {data.booking.tokenNumber !== null ? `#${data.booking.tokenNumber}` : "—"}
                </p>
              </div>
              <BookingStatusPill status={data.booking.status} />
            </div>

            <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat label={t("queue.nowServing")} value={data.queue.nowServingToken !== null ? `#${data.queue.nowServingToken}` : t("queue.notStarted")} />
              <Stat label={t("queue.ahead")} value={String(data.queue.ahead)} />
              <Stat label={t("queue.eta")} value={formatMinutes(data.queue.etaMinutes)} />
            </dl>

            <p className="mt-6 text-body-sm text-stone">
              {data.queue.etaFromObservedRate
                ? `Based on today's pace at this centre — about ${data.queue.observedMinutesPerLot} minutes per lot, from ${data.queue.servedToday} lots served so far.`
                : "Based on a planning figure. The estimate will sharpen once the centre has served a few lots today."}
              {isFetching && " · refreshing"}
            </p>
          </Card>

          <Card>
            <h2 className="text-heading-sm font-semibold">{t("dash.gatePass")}</h2>
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
  const { t } = useT();
  const { data, isPending, isError, error, refetch } = useFarmerLots();

  return (
    <Page>
      <PageHeader
        title={t("pay.title")}
        lede={t("pay.lede")}
      />

      {isPending && <div className="space-y-4"><SkeletonCard /><SkeletonCard /></div>}
      {isError && <ErrorNote error={error} onRetry={() => void refetch()} />}

      {data?.length === 0 && (
        <EmptyState title={t("pay.none")} body={t("pay.noneBody")} />
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
                {lot.breached && <Pill tone="bad">{t("pay.overdue")}</Pill>}
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
  const { t } = useT();
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
        <PageHeader title={t("book.confirmed")} />
        <Card className="border-0 bg-sky-tint">
          <p className="text-body">{t("book.yourPass")}</p>
          <p className="mt-1 font-mono text-heading-sm font-semibold">{create.data.booking.gatePassCode}</p>
          <p className="mt-3 text-body text-graphite">{t("book.willTell")}</p>
          <div className="mt-4 flex gap-2">
            <Link to="/farmer"><Button>{t("common.back")}</Button></Link>
            <Link to="/farmer/queue"><Button variant="ghost">{t("dash.seeQueue")}</Button></Link>
          </div>
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title={t("book.title")}
        lede={t("book.lede")}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-heading-sm font-semibold">{t("book.step1")}</h2>
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
          <h2 className="text-heading-sm font-semibold">{t("book.step2")}</h2>

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
                  <span className="text-body-sm text-stone">{t("book.left", { qty: formatQuintals(d.remainingQuintals) })}</span>
                </span>
                {/* Naming the constraint is what makes a small number credible. */}
                {d.bindingConstraint && (
                  <span className="mt-1 block text-caption text-stone">
                    {t("book.limitedBy", { what: d.bindingConstraint.toLowerCase() })}
                  </span>
                )}
              </button>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <h2 className="text-heading-sm font-semibold">{t("book.step3")}</h2>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-caption text-stone">{t("book.quantity")}</span>
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
            {create.isPending ? t("book.booking") : t("book.confirm")}
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
