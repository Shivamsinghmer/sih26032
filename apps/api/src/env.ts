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

const webOrigins = raw.WEB_ORIGIN.split(",")
  .map((o) => o.trim())
  .filter(Boolean);

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

export const env = {
  ...raw,
  webOrigins,
  demoMode,
  isProduction: raw.NODE_ENV === "production",
} as const;
