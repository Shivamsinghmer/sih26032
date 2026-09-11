/**
 * The shared pieces every panel uses.
 *
 * Styling follows docs/design.md: hairline borders never shadows, #0075de as
 * the only filled button on a screen, accent hues for card backgrounds, pills at
 * 9999px, no gradients.
 */

import type { ReactNode } from "react";
import { PAYMENT_STAGES, stageIndex, type BookingStatus, type PaymentStage } from "@mandi/shared";
import type { ApiRequestError } from "../lib/api.js";

/** Dates and money are formatted here, for en-IN. The API never formats. */
const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
});

export const formatDate = (iso: string) => dateFmt.format(new Date(iso));
export const formatTime = (iso: string) => timeFmt.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));

/** Integer paise arrive as a string; render rupees without ever making a float of them. */
export function formatRupees(paise: string | null): string {
  if (!paise) return "—";
  const n = BigInt(paise);
  const rupees = n / 100n;
  return `₹${rupees.toLocaleString("en-IN")}`;
}

export function formatQuintals(q: number | null): string {
  return q === null ? "—" : `${q.toLocaleString("en-IN")} qtl`;
}

/** Minutes as something a person reads: "1 hr 40 min". */
export function formatMinutes(mins: number | null): string {
  if (mins === null) return "—";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

export function Pill({ tone, children }: { tone: "neutral" | "good" | "warn" | "bad" | "info"; children: ReactNode }) {
  const tones = {
    neutral: "bg-paper-warmth text-ink-black/60",
    good: "bg-sky-tint text-notion-blue",
    warn: "bg-marigold text-ink-black",
    bad: "bg-coral text-pure-white",
    info: "bg-sky-wash text-ink-black",
  } as const;
  return <span className={`rounded-full px-3 py-1 text-caption font-medium ${tones[tone]}`}>{children}</span>;
}

export function BookingStatusPill({ status }: { status: BookingStatus }) {
  const map: Record<BookingStatus, { tone: Parameters<typeof Pill>[0]["tone"]; label: string }> = {
    BOOKED: { tone: "good", label: "Booked" },
    ARRIVED: { tone: "info", label: "Arrived" },
    IN_PROGRESS: { tone: "info", label: "Being served" },
    COMPLETED: { tone: "neutral", label: "Completed" },
    // The one status that must not look routine — it carries an instruction.
    RESLOTTED: { tone: "warn", label: "Slot moved" },
    NO_SHOW: { tone: "bad", label: "Missed" },
    CANCELLED: { tone: "neutral", label: "Cancelled" },
  };
  const { tone, label } = map[status];
  return <Pill tone={tone}>{label}</Pill>;
}

const STAGE_LABELS: Record<PaymentStage, string> = {
  AWAITING_JFORM: "Awaiting J-form",
  J_FORM_ISSUED: "J-form issued",
  LIFTED: "Lot lifted",
  AGENCY_ACKNOWLEDGED: "Agency acknowledged",
  SENT_FOR_PAYMENT: "Sent for payment",
  CREDITED: "Credited",
};

export const stageLabel = (stage: PaymentStage) => STAGE_LABELS[stage];

/**
 * The five-stage payment tracker.
 *
 * Renders the stage the server derived — it never computes one. The owner is
 * shown alongside a breach, because an overdue payment with no named office is
 * just a complaint.
 */
export function PaymentTracker({
  stage, breached, owner, hoursOverdue,
}: { stage: PaymentStage; breached: boolean; owner: string; hoursOverdue: number }) {
  const current = stageIndex(stage);

  return (
    <div>
      <ol className="flex flex-wrap gap-1.5" aria-label="Payment progress">
        {PAYMENT_STAGES.map((s, i) => {
          const done = i <= current;
          const isCurrent = i === current;
          return (
            <li key={s} className="flex min-w-[92px] flex-1 flex-col gap-1.5">
              <span
                className={`h-1.5 rounded-full ${done ? (breached && isCurrent ? "bg-coral" : "bg-notion-blue") : "bg-black/10"}`}
                aria-hidden
              />
              <span className={`text-caption ${isCurrent ? "font-medium text-ink-black" : "text-ink-black/40"}`}>
                {STAGE_LABELS[s]}
              </span>
            </li>
          );
        })}
      </ol>

      {breached && (
        <p className="mt-3 rounded-small bg-coral/10 px-3 py-2 text-body-sm text-ink-black">
          <strong>{hoursOverdue} hours past the 72-hour norm.</strong> Waiting on {owner}.
        </p>
      )}
    </div>
  );
}

/** A visible, honest failure. Never a blank panel. */
export function ErrorNote({ error, onRetry }: { error: ApiRequestError; onRetry?: () => void }) {
  return (
    <div className="surface-card p-card">
      <p className="text-body font-medium">{error.message}</p>
      {error.isUnavailable && (
        <p className="mt-1 text-body-sm text-stone">
          This is usually the database waking up after an idle spell.
        </p>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="transition-notion mt-3 rounded-button bg-sky-tint px-[15px] py-1.5 text-body-sm font-medium text-notion-blue hover:opacity-90"
        >
          Try again
        </button>
      )}
    </div>
  );
}

/** Matches the card it replaces, so the layout does not jump when data lands. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="surface-card p-card" aria-hidden>
      <div className="h-5 w-1/3 animate-pulse rounded-small bg-black/10" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="h-4 animate-pulse rounded-small bg-black/5" style={{ width: `${90 - i * 15}%` }} />
        ))}
      </div>
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="surface-card p-card text-center">
      <p className="text-body font-medium">{title}</p>
      <p className="mt-1 text-body-sm text-graphite">{body}</p>
    </div>
  );
}

export function Button({
  children, onClick, type = "button", variant = "primary", disabled, full,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "ghost";
  disabled?: boolean;
  full?: boolean;
}) {
  const styles =
    variant === "primary"
      ? "bg-notion-blue text-pure-white hover:opacity-90"
      : "bg-sky-tint text-notion-blue hover:opacity-90";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`transition-notion rounded-button px-[15px] py-2 text-body-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${full ? "w-full" : ""}`}
    >
      {children}
    </button>
  );
}
