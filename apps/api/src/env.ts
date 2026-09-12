/**
 * Environment, validated once at boot.
 *
 * A missing or malformed variable stops the process here with a readable
 * message, rather than surfacing three screens later as a 503 that looks like
 * a database problem.
 */

import { z } from "zod";

// Node loads .env natively; no dotenv dependency. Absent in production, where
// Railway injects the variables directly, so a missing file is not an error.
try {
  process.loadEnvFile();
} catch {
  // no .env on disk — fall through to whatever the platform injected
}

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Railway injects PORT. Read it, never hardcode it.
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required — see .env.example"),
  DIRECT_URL: z.string().min(1, "DIRECT_URL is required — see .env.example"),

  // Blank is meaningful: it selects demo mode. See `demoMode` below.
  CLERK_SECRET_KEY: z.string().default(""),
  CLERK_PUBLISHABLE_KEY: z.string().default(""),

  // Comma-separated list of allowed browser origins. Never `*`.
  WEB_ORIGIN: z.string().default("http://localhost:5173"),

  // Which seeded persona demo mode resolves. Without this, demo mode could only
  // ever be a farmer, and the officer and admin panels would be undevelopable
  // with auth off — which defeats the point of having a demo mode.
  // Ignored entirely when CLERK_SECRET_KEY is set.
  DEMO_ROLE: z.enum(["farmer", "officer", "admin"]).default("farmer"),

  // --- Notifications (prototype: email via Resend; production: SMS + IVR) ---
  // Blank is allowed: messages are then rendered and recorded but not sent, so
  // the app runs end to end without a provider account.
  RESEND_API_KEY: z.string().default(""),
  RESEND_FROM: z.string().default("Mandi Queue <onboarding@resend.dev>"),
  // Sends every message to one real inbox. Needed because Resend's shared
  // sender only delivers to the account owner, and seeded farmers have
  // addresses nobody owns. The recorded row still keeps the intended address.
  NOTIFY_REDIRECT_TO: z.string().default(""),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
  console.error(`Invalid environment:\n${lines.join("\n")}`);
  process.exit(1);
}

const raw = parsed.data;

/**
 * Demo mode is decided by the API and reported to the client, never chosen by
 * the browser — if the React app decided, anyone could flip it with a devtools
 * edit. With it on, auth is skipped and handlers resolve the first seeded farmer.
 */
const demoMode = raw.CLERK_SECRET_KEY.trim() === "";

/**
 * Allowed browser origins.
 *
 * An origin is scheme + host + port, and `cors` compares it as an exact string.
 * A value typed into a dashboard as `example.netlify.app` or with a trailing
 * slash therefore matches nothing, and the failure is silent: the preflight
 * still returns 204, just without an access-control-allow-origin header, and
 * the browser blocks the real request with a message that names neither the
 * expected nor the received value. Normalising here turns a very easy mistake
 * into a working config.
 */
const webOrigins = raw.WEB_ORIGIN.split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean)
  .map((o) => (/^https?:\/\//.test(o) ? o : `https://${o}`));

if (webOrigins.includes("*")) {
  console.error("WEB_ORIGIN must name exact origins. With `*`, any page on the internet can call this API with a phished token.");
  process.exit(1);
}

/**
 * Neon's pooled and unpooled hosts are not interchangeable, and the failure
 * mode when they are swapped is obscure: `db push` hangs or half-applies.
 * Warn rather than exit, since a self-hosted Postgres has no pooler at all.
 */
if (raw.DATABASE_URL === raw.DIRECT_URL && raw.DATABASE_URL.includes("neon.tech")) {
  console.warn("DATABASE_URL and DIRECT_URL are identical. On Neon, DATABASE_URL should contain `-pooler` and DIRECT_URL should not.");
}
for (const [name, url] of [["DATABASE_URL", raw.DATABASE_URL], ["DIRECT_URL", raw.DIRECT_URL]] as const) {
  if (url.includes("neon.tech") && !url.includes("connect_timeout=")) {
    console.warn(`${name} has no connect_timeout. Neon's first connection after an idle spell can take 7s+ and will fail against Prisma's 5s default. Append &connect_timeout=15.`);
  }
}

if (!raw.RESEND_API_KEY) {
  console.warn("RESEND_API_KEY is blank. Notifications will be rendered and recorded, but not delivered.");
} else if (raw.RESEND_FROM.includes("onboarding@resend.dev") && !raw.NOTIFY_REDIRECT_TO) {
  // The single most common way to think email is broken when it is not.
  console.warn(
    "RESEND_FROM is Resend's shared sender, which only delivers to your own account address. " +
      "Set NOTIFY_REDIRECT_TO to that address, or verify a domain in Resend.",
  );
}

if (raw.WEB_ORIGIN.trim() && webOrigins.join(",") !== raw.WEB_ORIGIN.trim()) {
  console.warn(
    `WEB_ORIGIN was normalised from "${raw.WEB_ORIGIN.trim()}" to "${webOrigins.join(", ")}". ` +
      "An origin must be scheme + host with no trailing slash, or CORS matches nothing.",
  );
}

export const env = {
  ...raw,
  webOrigins,
  demoMode,
  isProduction: raw.NODE_ENV === "production",
} as const;
