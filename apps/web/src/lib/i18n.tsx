/**
 * Language for the farmer panel.
 *
 * The notification templates have been multi-locale since the start; the panel
 * was not, which made "Punjabi SMS, English screen" the actual experience. This
 * closes that.
 *
 * The choice is written back to the server, not kept in the browser: it drives
 * which notification template renders, so a purely client-side toggle would
 * leave the SMS arriving in a language the farmer cannot read.
 *
 * Only the farmer panel is translated. Officers and district staff work in
 * English on a desktop all day, and pretending otherwise would mean shipping
 * machine-translated administrative vocabulary nobody asked for.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { Locale } from "@mandi/shared";
import { useMe } from "../auth/session.js";

type Dict = Record<string, string>;

const en: Dict = {
  "nav.dashboard": "Dashboard",
  "nav.book": "Book a slot",
  "nav.queue": "Queue",
  "nav.payments": "Payments",

  "dash.greeting": "Namaste, {name}",
  "dash.noBooking": "No slot booked",
  "dash.noBookingBody": "Book one when you are ready to sell.",
  "dash.nextSlot": "Your next slot",
  "dash.gatePass": "Gate pass",
  "dash.token": "Token",
  "dash.seeQueue": "See the queue",
  "dash.noPayment": "No payment pending",
  "dash.noPaymentBody": "Once your lot is weighed and a J-form is issued, the 72-hour payment clock starts here.",
  "dash.latestPayment": "Latest payment",
  "dash.allPayments": "All payments",
  "dash.moistureTitle": "Before you load the trolley",
  "dash.moistureBody":
    "Paddy is accepted up to 17% moisture. Above that the lot is rejected and you lose the slot — so dry the grain fully and check it before setting out.",

  "queue.title": "Live queue",
  "queue.lede": "The wait is estimated from what this centre has actually processed today, so it corrects itself.",
  "queue.yourToken": "Your token",
  "queue.nowServing": "Now serving",
  "queue.ahead": "Ahead of you",
  "queue.eta": "Estimated wait",
  "queue.notStarted": "Not started",
  "queue.noBooking": "No active booking",
  "queue.noBookingBody": "Book a slot to follow the queue on the day.",

  "pay.title": "Payments",
  "pay.lede": "Every stage is recorded from what actually happened, and each carries the office accountable for it.",
  "pay.none": "Nothing sold yet",
  "pay.noneBody": "Payments appear here once a lot has been weighed and a J-form issued.",
  "pay.overdue": "Overdue",

  "book.title": "Book a slot",
  "book.lede": "Only days the centre can actually handle are offered. A day that cannot take your quantity is not shown.",
  "book.step1": "1 · Choose a centre",
  "book.step2": "2 · Choose a day",
  "book.step3": "3 · How much are you bringing?",
  "book.quantity": "Quantity in quintals",
  "book.confirm": "Confirm booking",
  "book.booking": "Booking…",
  "book.left": "{qty} left",
  "book.limitedBy": "Limited today by {what}",
  "book.confirmed": "Slot confirmed",
  "book.yourPass": "Your gate pass is",
  "book.willTell":
    "If capacity at the centre changes before your slot, you will be told and moved — before you travel.",
  "book.noDays":
    "No day at this centre can take a booking in the next week. That is the centre's real capacity, not a system error — try another centre.",

  "common.back": "Back to dashboard",
  "common.retry": "Try again",
  "common.language": "Language",
};

const hi: Dict = {
  "nav.dashboard": "डैशबोर्ड",
  "nav.book": "स्लॉट बुक करें",
  "nav.queue": "कतार",
  "nav.payments": "भुगतान",

  "dash.greeting": "नमस्ते, {name}",
  "dash.noBooking": "कोई स्लॉट बुक नहीं",
  "dash.noBookingBody": "जब बेचने के लिए तैयार हों तब बुक करें।",
  "dash.nextSlot": "आपका अगला स्लॉट",
  "dash.gatePass": "गेट पास",
  "dash.token": "टोकन",
  "dash.seeQueue": "कतार देखें",
  "dash.noPayment": "कोई भुगतान बाकी नहीं",
  "dash.noPaymentBody": "लॉट तौलने और J-form जारी होने पर 72 घंटे की भुगतान अवधि यहाँ शुरू होगी।",
  "dash.latestPayment": "नवीनतम भुगतान",
  "dash.allPayments": "सभी भुगतान",
  "dash.moistureTitle": "ट्रॉली भरने से पहले",
  "dash.moistureBody":
    "धान 17% नमी तक स्वीकार किया जाता है। इससे अधिक होने पर लॉट अस्वीकार हो जाता है और स्लॉट चला जाता है — इसलिए अनाज पूरी तरह सुखाएँ और चलने से पहले जाँच लें।",

  "queue.title": "लाइव कतार",
  "queue.lede": "प्रतीक्षा का अनुमान इस केंद्र ने आज वास्तव में जितना काम किया है उससे लगाया जाता है, इसलिए यह अपने आप सही होता रहता है।",
  "queue.yourToken": "आपका टोकन",
  "queue.nowServing": "अभी चल रहा है",
  "queue.ahead": "आपसे आगे",
  "queue.eta": "अनुमानित प्रतीक्षा",
  "queue.notStarted": "शुरू नहीं हुआ",
  "queue.noBooking": "कोई सक्रिय बुकिंग नहीं",
  "queue.noBookingBody": "उस दिन कतार देखने के लिए स्लॉट बुक करें।",

  "pay.title": "भुगतान",
  "pay.lede": "हर चरण वास्तव में जो हुआ उससे दर्ज होता है, और हर एक के साथ ज़िम्मेदार कार्यालय दर्ज रहता है।",
  "pay.none": "अभी कुछ नहीं बेचा",
  "pay.noneBody": "लॉट तौलने और J-form जारी होने पर भुगतान यहाँ दिखेंगे।",
  "pay.overdue": "देरी",

  "book.title": "स्लॉट बुक करें",
  "book.lede": "केवल वे दिन दिखाए जाते हैं जिन्हें केंद्र वास्तव में संभाल सकता है। जो दिन आपकी मात्रा नहीं ले सकता वह दिखता ही नहीं।",
  "book.step1": "1 · केंद्र चुनें",
  "book.step2": "2 · दिन चुनें",
  "book.step3": "3 · आप कितना ला रहे हैं?",
  "book.quantity": "मात्रा (क्विंटल)",
  "book.confirm": "बुकिंग पक्की करें",
  "book.booking": "बुक हो रहा है…",
  "book.left": "{qty} बाकी",
  "book.limitedBy": "आज {what} के कारण सीमित",
  "book.confirmed": "स्लॉट पक्का",
  "book.yourPass": "आपका गेट पास है",
  "book.willTell": "यदि आपके स्लॉट से पहले केंद्र की क्षमता बदलती है, तो आपको बताया जाएगा और स्लॉट बदला जाएगा — आपके चलने से पहले।",
  "book.noDays": "अगले सप्ताह इस केंद्र पर कोई दिन बुकिंग नहीं ले सकता। यह केंद्र की वास्तविक क्षमता है, सिस्टम की खराबी नहीं — दूसरा केंद्र देखें।",

  "common.back": "डैशबोर्ड पर वापस",
  "common.retry": "फिर कोशिश करें",
  "common.language": "भाषा",
};

const pa: Dict = {
  "nav.dashboard": "ਡੈਸ਼ਬੋਰਡ",
  "nav.book": "ਸਲਾਟ ਬੁੱਕ ਕਰੋ",
  "nav.queue": "ਕਤਾਰ",
  "nav.payments": "ਭੁਗਤਾਨ",

  "dash.greeting": "ਸਤ ਸ੍ਰੀ ਅਕਾਲ, {name}",
  "dash.noBooking": "ਕੋਈ ਸਲਾਟ ਬੁੱਕ ਨਹੀਂ",
  "dash.noBookingBody": "ਜਦੋਂ ਵੇਚਣ ਲਈ ਤਿਆਰ ਹੋਵੋ ਤਾਂ ਬੁੱਕ ਕਰੋ।",
  "dash.nextSlot": "ਤੁਹਾਡਾ ਅਗਲਾ ਸਲਾਟ",
  "dash.gatePass": "ਗੇਟ ਪਾਸ",
  "dash.token": "ਟੋਕਨ",
  "dash.seeQueue": "ਕਤਾਰ ਵੇਖੋ",
  "dash.noPayment": "ਕੋਈ ਭੁਗਤਾਨ ਬਾਕੀ ਨਹੀਂ",
  "dash.noPaymentBody": "ਲਾਟ ਤੋਲਣ ਅਤੇ J-ਫਾਰਮ ਜਾਰੀ ਹੋਣ 'ਤੇ 72 ਘੰਟਿਆਂ ਦਾ ਸਮਾਂ ਇੱਥੇ ਸ਼ੁਰੂ ਹੋਵੇਗਾ।",
  "dash.latestPayment": "ਤਾਜ਼ਾ ਭੁਗਤਾਨ",
  "dash.allPayments": "ਸਾਰੇ ਭੁਗਤਾਨ",
  "dash.moistureTitle": "ਟਰਾਲੀ ਭਰਨ ਤੋਂ ਪਹਿਲਾਂ",
  "dash.moistureBody":
    "ਝੋਨਾ 17% ਨਮੀ ਤੱਕ ਸਵੀਕਾਰ ਹੁੰਦਾ ਹੈ। ਇਸ ਤੋਂ ਵੱਧ ਹੋਣ 'ਤੇ ਲਾਟ ਰੱਦ ਹੋ ਜਾਂਦੀ ਹੈ ਅਤੇ ਸਲਾਟ ਚਲਾ ਜਾਂਦਾ ਹੈ — ਇਸ ਲਈ ਦਾਣੇ ਪੂਰੀ ਤਰ੍ਹਾਂ ਸੁਕਾਓ ਅਤੇ ਤੁਰਨ ਤੋਂ ਪਹਿਲਾਂ ਜਾਂਚ ਲਵੋ।",

  "queue.title": "ਲਾਈਵ ਕਤਾਰ",
  "queue.lede": "ਉਡੀਕ ਦਾ ਅੰਦਾਜ਼ਾ ਇਸ ਕੇਂਦਰ ਨੇ ਅੱਜ ਅਸਲ ਵਿੱਚ ਜਿੰਨਾ ਕੰਮ ਕੀਤਾ ਹੈ ਉਸ ਤੋਂ ਲਾਇਆ ਜਾਂਦਾ ਹੈ, ਇਸ ਲਈ ਇਹ ਆਪਣੇ ਆਪ ਠੀਕ ਹੁੰਦਾ ਰਹਿੰਦਾ ਹੈ।",
  "queue.yourToken": "ਤੁਹਾਡਾ ਟੋਕਨ",
  "queue.nowServing": "ਹੁਣ ਚੱਲ ਰਿਹਾ",
  "queue.ahead": "ਤੁਹਾਡੇ ਤੋਂ ਅੱਗੇ",
  "queue.eta": "ਅਨੁਮਾਨਿਤ ਉਡੀਕ",
  "queue.notStarted": "ਸ਼ੁਰੂ ਨਹੀਂ ਹੋਇਆ",
  "queue.noBooking": "ਕੋਈ ਸਰਗਰਮ ਬੁਕਿੰਗ ਨਹੀਂ",
  "queue.noBookingBody": "ਉਸ ਦਿਨ ਕਤਾਰ ਵੇਖਣ ਲਈ ਸਲਾਟ ਬੁੱਕ ਕਰੋ।",

  "pay.title": "ਭੁਗਤਾਨ",
  "pay.lede": "ਹਰ ਪੜਾਅ ਅਸਲ ਵਿੱਚ ਜੋ ਹੋਇਆ ਉਸ ਤੋਂ ਦਰਜ ਹੁੰਦਾ ਹੈ, ਅਤੇ ਹਰ ਇੱਕ ਨਾਲ ਜ਼ਿੰਮੇਵਾਰ ਦਫ਼ਤਰ ਦਰਜ ਰਹਿੰਦਾ ਹੈ।",
  "pay.none": "ਅਜੇ ਕੁਝ ਨਹੀਂ ਵੇਚਿਆ",
  "pay.noneBody": "ਲਾਟ ਤੋਲਣ ਅਤੇ J-ਫਾਰਮ ਜਾਰੀ ਹੋਣ 'ਤੇ ਭੁਗਤਾਨ ਇੱਥੇ ਦਿਖਣਗੇ।",
  "pay.overdue": "ਦੇਰੀ",

  "book.title": "ਸਲਾਟ ਬੁੱਕ ਕਰੋ",
  "book.lede": "ਸਿਰਫ਼ ਉਹ ਦਿਨ ਦਿਖਾਏ ਜਾਂਦੇ ਹਨ ਜੋ ਕੇਂਦਰ ਅਸਲ ਵਿੱਚ ਸੰਭਾਲ ਸਕਦਾ ਹੈ। ਜੋ ਦਿਨ ਤੁਹਾਡੀ ਮਾਤਰਾ ਨਹੀਂ ਲੈ ਸਕਦਾ, ਉਹ ਦਿਖਦਾ ਹੀ ਨਹੀਂ।",
  "book.step1": "1 · ਕੇਂਦਰ ਚੁਣੋ",
  "book.step2": "2 · ਦਿਨ ਚੁਣੋ",
  "book.step3": "3 · ਤੁਸੀਂ ਕਿੰਨਾ ਲਿਆ ਰਹੇ ਹੋ?",
  "book.quantity": "ਮਾਤਰਾ (ਕੁਇੰਟਲ)",
  "book.confirm": "ਬੁਕਿੰਗ ਪੱਕੀ ਕਰੋ",
  "book.booking": "ਬੁੱਕ ਹੋ ਰਿਹਾ…",
  "book.left": "{qty} ਬਾਕੀ",
  "book.limitedBy": "ਅੱਜ {what} ਕਰਕੇ ਸੀਮਤ",
  "book.confirmed": "ਸਲਾਟ ਪੱਕਾ",
  "book.yourPass": "ਤੁਹਾਡਾ ਗੇਟ ਪਾਸ ਹੈ",
  "book.willTell": "ਜੇ ਤੁਹਾਡੇ ਸਲਾਟ ਤੋਂ ਪਹਿਲਾਂ ਕੇਂਦਰ ਦੀ ਸਮਰੱਥਾ ਬਦਲਦੀ ਹੈ, ਤਾਂ ਤੁਹਾਨੂੰ ਦੱਸਿਆ ਜਾਵੇਗਾ ਅਤੇ ਸਲਾਟ ਬਦਲਿਆ ਜਾਵੇਗਾ — ਤੁਹਾਡੇ ਤੁਰਨ ਤੋਂ ਪਹਿਲਾਂ।",
  "book.noDays": "ਅਗਲੇ ਹਫ਼ਤੇ ਇਸ ਕੇਂਦਰ 'ਤੇ ਕੋਈ ਦਿਨ ਬੁਕਿੰਗ ਨਹੀਂ ਲੈ ਸਕਦਾ। ਇਹ ਕੇਂਦਰ ਦੀ ਅਸਲ ਸਮਰੱਥਾ ਹੈ, ਸਿਸਟਮ ਦੀ ਖ਼ਰਾਬੀ ਨਹੀਂ — ਹੋਰ ਕੇਂਦਰ ਵੇਖੋ।",

  "common.back": "ਡੈਸ਼ਬੋਰਡ 'ਤੇ ਵਾਪਸ",
  "common.retry": "ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ",
  "common.language": "ਭਾਸ਼ਾ",
};

const DICTS: Record<Locale, Dict> = { en, hi, pa };

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  hi: "हिन्दी",
  pa: "ਪੰਜਾਬੀ",
};

export type Translate = (key: keyof typeof en, vars?: Record<string, string | number>) => string;

const I18nContext = createContext<{ locale: Locale; t: Translate }>({
  locale: "en",
  t: (key) => en[key] ?? key,
});

export function useT() {
  return useContext(I18nContext);
}

/**
 * Locale comes from the farmer's own record, so the screen and the SMS always
 * agree. English is the fallback for officers and admins, who have no locale.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const locale: Locale = me.farmer?.preferredLocale ?? "en";
  const dict = DICTS[locale] ?? en;

  const t: Translate = (key, vars) => {
    // Falling back to English rather than showing a raw key: a missing string
    // should look unpolished, not broken.
    let out = dict[key] ?? en[key] ?? String(key);
    for (const [k, v] of Object.entries(vars ?? {})) out = out.replace(`{${k}}`, String(v));
    return out;
  };

  return <I18nContext.Provider value={{ locale, t }}>{children}</I18nContext.Provider>;
}
