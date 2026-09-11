/**
 * Date handling.
 *
 * The API speaks ISO 8601 UTC and never formats for a locale — the client does
 * that for en-IN. `CapacityDay.date` is a @db.Date column, so it must be
 * normalised to midnight UTC or an upsert silently creates a second row for the
 * same day at a different time.
 */

/** Midnight UTC for the calendar day of the given instant. */
export function startOfDayUtc(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

export function endOfDayUtc(d: Date): Date {
  const out = startOfDayUtc(d);
  out.setUTCHours(23, 59, 59, 999);
  return out;
}

/** Parses a YYYY-MM-DD or full ISO string to midnight UTC, or null when unusable. */
export function parseDateOnly(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return startOfDayUtc(parsed);
}

export function today(): Date {
  return startOfDayUtc(new Date());
}
