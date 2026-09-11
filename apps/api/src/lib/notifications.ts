/**
 * Notifications.
 *
 * **The prototype sends email, via Resend. Production must send SMS and IVR.**
 *
 * That is a deliberate substitution, not a claim that email is the right
 * channel: the farmers this system exists for are the ones least likely to have
 * or check an inbox, and many are on feature phones where SMS is the only thing
 * that arrives. The reason for the swap is practical — Indian commercial SMS
 * requires a DLT-registered header and pre-approved template bodies, which takes
 * weeks to obtain and cannot be done inside a hackathon window.
 *
 * What the swap buys is that the pipeline becomes **real** rather than stubbed:
 * templates render per locale, a message is actually delivered, and the row
 * records what happened. Swapping the transport back to SMS is one function,
 * because everything above it already speaks in DLT-shaped template keys.
 *
 * Say this out loud rather than letting a panel discover it.
 */

import { Resend } from "resend";
import type { Constraint, Locale, NotificationTemplate } from "@mandi/shared";
import { prisma } from "../db.js";
import { env } from "../env.js";

export type TemplateVars = Record<string, string | number>;

type Bodies = Record<Locale, string>;

/** Subject lines. Kept short — this is the only part most people read. */
const SUBJECTS: Record<NotificationTemplate, Bodies> = {
  SLOT_CONFIRMED: {
    en: "Slot confirmed at {centre}",
    hi: "{centre} में स्लॉट बुक",
    pa: "{centre} ਵਿਖੇ ਸਲਾਟ ਬੁੱਕ",
  },
  SLOT_RESLOTTED: {
    en: "Your slot has moved — do not travel today",
    hi: "आपका स्लॉट बदल गया — आज न आएं",
    pa: "ਤੁਹਾਡਾ ਸਲਾਟ ਬਦਲ ਗਿਆ — ਅੱਜ ਨਾ ਆਓ",
  },
  MOISTURE_FAIL: {
    en: "Moisture too high — a new slot has been issued",
    hi: "नमी अधिक — नया स्लॉट जारी",
    pa: "ਨਮੀ ਵੱਧ — ਨਵਾਂ ਸਲਾਟ ਜਾਰੀ",
  },
  JFORM_ISSUED: {
    en: "J-form {jForm} issued — payment due in {slaHours} hours",
    hi: "J-form {jForm} जारी — {slaHours} घंटे में भुगतान",
    pa: "J-ਫਾਰਮ {jForm} ਜਾਰੀ — {slaHours} ਘੰਟਿਆਂ ਵਿੱਚ ਭੁਗਤਾਨ",
  },
  PAYMENT_CREDITED: {
    en: "₹{amount} credited for J-form {jForm}",
    hi: "J-form {jForm} के लिए ₹{amount} जमा",
    pa: "J-ਫਾਰਮ {jForm} ਲਈ ₹{amount} ਜਮ੍ਹਾਂ",
  },
};

/**
 * The message bodies, one per locale.
 *
 * These stay SMS-length on purpose. They are the exact text that will be
 * submitted for DLT approval, so writing them long now would mean rewriting
 * them later — and a farmer reading on a small screen is served better by two
 * sentences than by a letter.
 */
const TEMPLATES: Record<NotificationTemplate, Bodies> = {
  SLOT_CONFIRMED: {
    en: "Slot confirmed at {centre} on {date} at {time}. Gate pass {gatePass}. Quantity {quantity} qtl.",
    hi: "{centre} में {date} को {time} बजे स्लॉट बुक हो गया। गेट पास {gatePass}। मात्रा {quantity} क्विंटल।",
    pa: "{centre} ਵਿਖੇ {date} ਨੂੰ {time} ਵਜੇ ਸਲਾਟ ਬੁੱਕ ਹੋ ਗਿਆ। ਗੇਟ ਪਾਸ {gatePass}। ਮਾਤਰਾ {quantity} ਕੁਇੰਟਲ।",
  },
  SLOT_RESLOTTED: {
    en: "{reason} Your new slot is {date} at {time}. Please do not travel today.",
    hi: "{reason} आपका नया स्लॉट {date} को {time} बजे है। कृपया आज न आएं।",
    pa: "{reason} ਤੁਹਾਡਾ ਨਵਾਂ ਸਲਾਟ {date} ਨੂੰ {time} ਵਜੇ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਅੱਜ ਨਾ ਆਓ।",
  },
  MOISTURE_FAIL: {
    en: "Moisture {moisture}% is above the {limit}% limit. Please re-dry. A new slot has been issued for {date}.",
    hi: "नमी {moisture}% सीमा {limit}% से अधिक है। कृपया सुखाएं। {date} के लिए नया स्लॉट जारी किया गया है।",
    pa: "ਨਮੀ {moisture}% ਸੀਮਾ {limit}% ਤੋਂ ਵੱਧ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਸੁਕਾਓ। {date} ਲਈ ਨਵਾਂ ਸਲਾਟ ਜਾਰੀ ਕੀਤਾ ਗਿਆ ਹੈ।",
  },
  JFORM_ISSUED: {
    en: "J-form {jForm} issued for {quantity} qtl, ₹{amount}. Payment is due within {slaHours} hours.",
    hi: "{quantity} क्विंटल के लिए J-form {jForm} जारी, राशि ₹{amount}। भुगतान {slaHours} घंटे में देय।",
    pa: "{quantity} ਕੁਇੰਟਲ ਲਈ J-ਫਾਰਮ {jForm} ਜਾਰੀ, ਰਕਮ ₹{amount}। ਭੁਗਤਾਨ {slaHours} ਘੰਟਿਆਂ ਵਿੱਚ।",
  },
  PAYMENT_CREDITED: {
    en: "₹{amount} credited to your account for J-form {jForm}.",
    hi: "J-form {jForm} के लिए ₹{amount} आपके खाते में जमा कर दिए गए हैं।",
    pa: "J-ਫਾਰਮ {jForm} ਲਈ ₹{amount} ਤੁਹਾਡੇ ਖਾਤੇ ਵਿੱਚ ਜਮ੍ਹਾਂ ਹੋ ਗਏ ਹਨ।",
  },
};

/** Why a slot moved, in the farmer's own language. */
const CONSTRAINT_REASONS: Record<Constraint, Bodies> = {
  BARDANA: {
    en: "Gunny bag shortage at {centre}.",
    hi: "{centre} में बारदाना (बोरी) की कमी है।",
    pa: "{centre} ਵਿਖੇ ਬਾਰਦਾਨੇ (ਬੋਰੀਆਂ) ਦੀ ਘਾਟ ਹੈ।",
  },
  LABOUR: {
    en: "Labour shortage at {centre}.",
    hi: "{centre} में मज़दूरों की कमी है।",
    pa: "{centre} ਵਿਖੇ ਮਜ਼ਦੂਰਾਂ ਦੀ ਘਾਟ ਹੈ।",
  },
  WEIGHBRIDGE: {
    en: "Reduced weighbridge hours at {centre}.",
    hi: "{centre} में तौल-कांटे का समय कम है।",
    pa: "{centre} ਵਿਖੇ ਤੋਲ-ਕੰਡੇ ਦਾ ਸਮਾਂ ਘੱਟ ਹੈ।",
  },
  YARD: {
    en: "Unlifted stock is occupying the yard at {centre}.",
    hi: "{centre} में पिछला उठाव न होने से जगह भरी है।",
    pa: "{centre} ਵਿਖੇ ਪਿਛਲੀ ਲਿਫ਼ਟਿੰਗ ਨਾ ਹੋਣ ਕਰਕੇ ਵਿਹੜਾ ਭਰਿਆ ਹੋਇਆ ਹੈ।",
  },
};

function fill(text: string, vars: TemplateVars): string {
  // An unknown key is left visible rather than silently blanked, so a missing
  // variable shows up in testing instead of shipping as a gap in a sentence.
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

export function render(template: NotificationTemplate, locale: Locale, vars: TemplateVars): string {
  return fill(TEMPLATES[template][locale] ?? TEMPLATES[template].en, vars);
}

export function renderSubject(template: NotificationTemplate, locale: Locale, vars: TemplateVars): string {
  return fill(SUBJECTS[template][locale] ?? SUBJECTS[template].en, vars);
}

export function localisedReslotReason(constraint: Constraint, centreName: string, locale: Locale): string {
  const body = CONSTRAINT_REASONS[constraint][locale] ?? CONSTRAINT_REASONS[constraint].en;
  return body.replace("{centre}", centreName);
}

/** Rupees from integer paise, formatted for an Indian reader. */
export function formatPaise(paise: bigint): string {
  return Number(paise / 100n).toLocaleString("en-IN");
}

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

/**
 * Minimal HTML. Deliberately plain: the message is two sentences, and a farmer
 * on a slow connection should not wait on a layout.
 */
function wrap(subject: string, body: string, locale: Locale): string {
  return `<!doctype html><html lang="${locale}"><body style="margin:0;background:#f6f5f4;font:16px/1.5 system-ui,sans-serif;color:#000">
<div style="max-width:520px;margin:0 auto;padding:24px">
  <p style="margin:0 0 16px;font-size:14px;color:#757575">Mandi Queue</p>
  <div style="background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:12px;padding:24px">
    <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${escapeHtml(subject)}</h1>
    <p style="margin:0;font-size:16px">${escapeHtml(body)}</p>
  </div>
  <p style="margin:16px 0 0;font-size:12px;color:#757575">
    Prototype notice: in production this message is delivered by SMS and IVR, which is what reaches a farmer on a feature phone.
  </p>
</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export interface NotifyInput {
  farmerId: string;
  template: NotificationTemplate;
  vars: TemplateVars;
}

/**
 * Renders, sends and records one notification.
 *
 * **Never throws.** A failure to notify must not roll back the booking, re-slot
 * or J-form that caused it — the sale happened whether or not the email landed.
 * Every outcome is recorded instead: SENT when the provider accepted it, FAILED
 * with the reason when it did not, QUEUED when there is no provider configured.
 */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const farmer = await prisma.farmer.findUnique({
      where: { id: input.farmerId },
      select: { phone: true, email: true, preferredLocale: true, name: true },
    });
    if (!farmer) {
      console.error(`notify: no farmer ${input.farmerId}, template ${input.template}`);
      return;
    }

    const locale = farmer.preferredLocale as Locale;
    const body = render(input.template, locale, input.vars);
    const subject = renderSubject(input.template, locale, input.vars);

    /**
     * Resend's shared sender can only deliver to the account owner's own
     * address, and seeded farmers have addresses nobody owns. NOTIFY_REDIRECT_TO
     * points every message at one real inbox so the demo actually delivers —
     * and the row still records the address it was *meant* for, so the redirect
     * cannot quietly rewrite the audit trail.
     */
    const intended = farmer.email;
    const deliverTo = env.NOTIFY_REDIRECT_TO || intended;

    let status: "SENT" | "FAILED" | "QUEUED" = "QUEUED";
    let error: string | null = null;

    if (!resend) {
      error = "RESEND_API_KEY is not set; message recorded but not sent.";
    } else if (!deliverTo) {
      status = "FAILED";
      error = "This farmer has no email address and NOTIFY_REDIRECT_TO is not set.";
    } else {
      const sent = await resend.emails.send({
        from: env.RESEND_FROM,
        to: deliverTo,
        subject,
        html: wrap(subject, body, locale),
        text: body,
      });
      if (sent.error) {
        status = "FAILED";
        error = `${sent.error.name}: ${sent.error.message}`;
      } else {
        status = "SENT";
      }
    }

    await prisma.notification.create({
      data: {
        farmerId: input.farmerId,
        channel: "EMAIL",
        // Still the DLT-shaped key, so the SMS migration is a transport swap.
        template: input.template,
        locale: farmer.preferredLocale,
        body,
        // The address this was addressed to, not the redirect target.
        toPhone: intended ?? farmer.phone,
        status,
        sentAt: status === "SENT" ? new Date() : null,
        error,
      },
    });

    const tag = status === "SENT" ? "sent" : status === "FAILED" ? "FAILED" : "queued";
    const redirected = env.NOTIFY_REDIRECT_TO && intended && env.NOTIFY_REDIRECT_TO !== intended;
    console.log(
      `[email:${tag}] ${input.template} (${locale}) -> ${deliverTo ?? "nobody"}` +
        `${redirected ? ` [redirected from ${intended}]` : ""}` +
        `${error ? `\n           ${error}` : ""}\n           ${body}`,
    );
  } catch (caught) {
    console.error(`notify: failed to record ${input.template} for ${input.farmerId}`, caught);
  }
}

/** Fans out to many farmers — the re-slot path, mainly. */
export async function notifyMany(inputs: NotifyInput[]): Promise<void> {
  // Sequential on purpose: Resend rate-limits, and a re-slot can touch dozens of
  // farmers at once. Throughput does not matter here; not dropping any does.
  for (const input of inputs) await notify(input);
}
