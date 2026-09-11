/**
 * The language switch.
 *
 * It writes to the server rather than to localStorage, because the same choice
 * decides which notification template renders — a browser-only toggle would
 * leave the SMS arriving in a language the farmer cannot read.
 */

import { LOCALES, type Locale } from "@mandi/shared";
import { useSetLocale } from "../lib/hooks.js";
import { useT, LOCALE_NAMES } from "../lib/i18n.js";

export function LanguageToggle() {
  const { locale } = useT();
  const setLocale = useSetLocale();

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Language">
      {LOCALES.map((l: Locale) => (
        <button
          key={l}
          type="button"
          onClick={() => l !== locale && setLocale.mutate(l)}
          disabled={setLocale.isPending}
          aria-pressed={l === locale}
          className={`transition-notion rounded-button px-2.5 py-1 text-caption font-medium disabled:opacity-50 ${
            l === locale ? "bg-sky-tint text-notion-blue" : "text-ink-black/54 hover:text-ink-black"
          }`}
        >
          {LOCALE_NAMES[l]}
        </button>
      ))}
    </div>
  );
}
