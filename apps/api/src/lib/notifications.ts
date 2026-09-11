/**
 * Notifications.
 *
 * **Delivery is stubbed and says so.** Every notification is recorded as a real
 * `Notification` row and logged to the console; nothing is handed to an SMS
 * provider yet. Declaring that boundary matters more than hiding it — a hidden
 * mock is punished far harder than a declared one.
 *
 * What is real here is the part that is actually hard to retrofit: the rows, the
 * per-locale template bodies, and the DLT template key recorded against each
 * send. Indian commercial SMS requires pre-approved template bodies, so
 * `template` is operationally meaningful rather than a log label, and wiring a
 * provider later becomes one function rather than a rewrite.
 */

import type { Constraint, Locale, NotificationTemplate } from "@mandi/shared";
import { prisma } from "../db.js";

/** Values substituted into a template body. */
export type TemplateVars = Record<string, string | number>;

type Bodies = Record<Locale, string>;

/**
 * The DLT-registered bodies, one per locale.
 *
 * A farmer who cannot read the message cannot act on it, and the whole argument
 * for this system is that an unexplained delay is what sends people back to
 * sleeping in the queue. `Farmer.preferredLocale` picks the row.
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
    en: "J-form {jForm} issued for {quantity} qtl, Rs {amount}. Payment is due within {slaHours} hours.",
    hi: "{quantity} क्विंटल के लिए J-form {jForm} जारी, राशि {amount} रुपये। भुगतान {slaHours} घंटे में देय।",
    pa: "{quantity} ਕੁਇੰਟਲ ਲਈ J-ਫਾਰਮ {jForm} ਜਾਰੀ, ਰਕਮ {amount} ਰੁਪਏ। ਭੁਗਤਾਨ {slaHours} ਘੰਟਿਆਂ ਵਿੱਚ।",
  },
  PAYMENT_CREDITED: {
    en: "Rs {amount} credited to your account for J-form {jForm}.",
    hi: "J-form {jForm} के लिए {amount} रुपये आपके खाते में जमा कर दिए गए हैं।",
    pa: "J-ਫਾਰਮ {jForm} ਲਈ {amount} ਰੁਪਏ ਤੁਹਾਡੇ ਖਾਤੇ ਵਿੱਚ ਜਮ੍ਹਾਂ ਹੋ ਗਏ ਹਨ।",
  },
};

/** Substitutes {placeholders}. An unknown key is left visible rather than silently blanked. */
export function render(
  template: NotificationTemplate,
  locale: Locale,
  vars: TemplateVars,
): string {
  const body = TEMPLATES[template][locale] ?? TEMPLATES[template].en;
  return body.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

/** Rupees from integer paise, formatted for an Indian reader. */
export function formatPaise(paise: bigint): string {
  const rupees = Number(paise / 100n);
  return rupees.toLocaleString("en-IN");
}

/**
 * Why a slot moved, in the farmer's own language.
 *
 * `reslotReason()` in the shared package returns English, which is right for the
 * stored audit trail and for tests. It is wrong for the SMS: a reason the farmer
 * cannot read is no better than "slot unavailable", and the whole argument for
 * this system is that an unexplained delay is what sends people back to sleeping
 * in the queue.
 */
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

export function localisedReslotReason(
  constraint: Constraint,
  centreName: string,
  locale: Locale,
): string {
  const body = CONSTRAINT_REASONS[constraint][locale] ?? CONSTRAINT_REASONS[constraint].en;
  return body.replace("{centre}", centreName);
}

export interface NotifyInput {
  farmerId: string;
  template: NotificationTemplate;
  vars: TemplateVars;
}

/**
 * Records one notification and logs it.
 *
 * Never throws: a failure to notify must not roll back the booking, re-slot or
 * J-form that caused it. The row is the audit trail, so a send that could not be
 * recorded is logged loudly rather than swallowed.
 */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const farmer = await prisma.farmer.findUnique({
      where: { id: input.farmerId },
      select: { phone: true, preferredLocale: true },
    });
    if (!farmer) {
      console.error(`notify: no farmer ${input.farmerId}, template ${input.template}`);
      return;
    }

    const locale = farmer.preferredLocale as Locale;
    const body = render(input.template, locale, input.vars);

    await prisma.notification.create({
      data: {
        farmerId: input.farmerId,
        channel: "SMS",
        template: input.template,
        locale: farmer.preferredLocale,
        body,
        toPhone: farmer.phone,
        // QUEUED, not SENT: nothing has been delivered. Marking these SENT would
        // be the exact hidden mock this project promises not to ship.
        status: "QUEUED",
      },
    });

    console.log(`[sms:stub] -> ${farmer.phone} (${locale}) ${input.template}\n           ${body}`);
  } catch (error) {
    console.error(`notify: failed to record ${input.template} for ${input.farmerId}`, error);
  }
}

/** Fans out one template to many farmers — the re-slot path, mainly. */
export async function notifyMany(inputs: NotifyInput[]): Promise<void> {
  for (const input of inputs) await notify(input);
}
