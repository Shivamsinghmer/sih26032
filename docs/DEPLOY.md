# Deploying

Two services, deployed separately, exactly as [ARCHITECTURE.md](./ARCHITECTURE.md)
describes: the React app to Vercel as static files on a CDN, and the API to
Railway as one long-lived process.

Both configs are committed — `vercel.json` and `railway.json` at the repo root —
so neither platform needs its build settings filled in by hand.

## Why deploy at all, rather than testing on the LAN

The Aadhaar scanner needs the camera, and `getUserMedia` only works in a
**secure context**. On a plain `http://192.168.x.x` address the camera never
opens, whatever the decoder does. A LAN test therefore needs self-signed HTTPS
plus a firewall exception, and both platforms below give a real certificate for
nothing.

## Order matters

The two services have to know each other's URLs, and neither exists yet. Deploy
in this order:

1. **API to Railway** → gives you `https://something.up.railway.app`
2. **Web to Vercel**, with `VITE_API_URL` set to that → gives you `https://something.vercel.app`
3. **Back to Railway**: set `WEB_ORIGIN` to the Vercel URL and redeploy

Step 3 is not optional. CORS on the API allows exactly the web origin and never
`*`, so until `WEB_ORIGIN` is right, every request from the browser fails.

---

## 1 · API on Railway

```bash
npm i -g @railway/cli
railway login
railway init          # or: railway link, for an existing project
railway up
```

Then set the variables. `PORT` is injected by Railway — never set it yourself.

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** string (contains `-pooler`), with `connect_timeout=15` |
| `DIRECT_URL` | Neon **direct** string (no `-pooler`), with `connect_timeout=15` |
| `CLERK_SECRET_KEY` | `sk_test_…` — leave blank ONLY if you want demo mode in public |
| `CLERK_PUBLISHABLE_KEY` | `pk_test_…` |
| `WEB_ORIGIN` | the Vercel URL, once you have it (step 3) |
| `NODE_ENV` | `production` |
| `RESEND_API_KEY` | optional; blank records notifications without sending |
| `NOTIFY_REDIRECT_TO` | your own address, if using Resend's shared sender |

Railway reads `railway.json`, which pins **one replica**. Leave it that way:
Socket.IO rooms are in-process, so a second replica silently drops half the
broadcasts. Horizontal scaling needs a Redis adapter first.

The health check is `/health`, which answers `{ ok, db, dbLatencyMs }`. A
`dbLatencyMs` of several seconds on the first request is Neon's free tier waking
its compute, not a fault.

## 2 · Web on Netlify or Vercel

Either works; both configs are committed (`netlify.toml`, `vercel.json`) so the
build command does not have to be typed into a dashboard.

**If you set the build command by hand, it must build `@mandi/shared` first.**
`npm --workspace @mandi/web run build` alone does not, and the failure is
misleading: every import of `@mandi/shared` reports "Cannot find module",
followed by dozens of implicit-any errors that look like a broken codebase
rather than a missing build step. The web package now runs a `prebuild` that
builds shared, so that command self-heals — but the committed config is the
thing to rely on.

### Vercel

```bash
npm i -g vercel
vercel login
vercel link
vercel --prod
```

Vercel reads `vercel.json`, so the build command, output directory and SPA
rewrites are already set. Add two environment variables:

| Variable | Value |
|---|---|
| `VITE_API_URL` | the Railway URL, no trailing slash |
| `VITE_CLERK_PUBLISHABLE_KEY` | `pk_test_…` |

**`VITE_*` values are inlined at build time**, so they must exist *before* the
build runs, and changing one means redeploying. None of them may be a secret —
the Clerk *publishable* key belongs here; the secret key never leaves the API.

The failure mode worth knowing: if `VITE_CLERK_PUBLISHABLE_KEY` is missing when
the bundle is built, the app ships with no Clerk provider and no error to warn
you. Verify a deploy by grepping the built assets:

```bash
curl -s https://YOUR-APP.vercel.app/ | grep -oE 'pk_(test|live)_[A-Za-z0-9]+' | sort -u
```

## 3 · Close the loop

Set `WEB_ORIGIN` on Railway to the Vercel URL and redeploy the API. Then check:

```bash
curl https://YOUR-API.up.railway.app/health
# {"ok":true,"db":"up","dbLatencyMs":…,"demoMode":false}
```

Open the Vercel URL. If the panels load but every request fails with a CORS
error in the console, `WEB_ORIGIN` does not match — it must be the exact origin,
scheme included, with no trailing slash.

## Seeding the deployed database

The database is the same Neon instance either way, so seeding is done from your
machine rather than from the deployed service:

```bash
npm run db:push -w @mandi/api     # only if the schema changed
npm run db:seed -w @mandi/api
```

`db:seed` **deletes and recreates** the district. Say so in the group chat
before running it against a database anyone else is demoing from.

## Demo mode in public

Leaving `CLERK_SECRET_KEY` blank on Railway puts the deployed API into demo
mode: authentication is off and **every panel is open to anyone with the URL**.
That is genuinely useful for a jury who should not have to sign in, and
genuinely dangerous for anything else. The nav shows a `demo mode` badge
whenever it is on, read from `/me` — the API's own answer, not the browser's.

`DEMO_ROLE` picks which seeded persona is resolved: `farmer`, `officer` or
`admin`. It is read from the server environment and never from a request, so a
visitor cannot promote themselves.

## What still will not work in production

Stated here so nobody discovers it in front of a panel:

- **SMS and IVR.** Notifications go by email via Resend; Indian commercial SMS
  needs DLT registration. See the README.
- **Land records.** No Jamabandi/Khasra integration exists, so `landVerified`
  is set by seed data only.
- **PFMS.** Payment stages are recorded by hand through the officer and admin
  panels; there is no payment rail behind them.
- **Aadhaar beyond the signature check.** A genuine UIDAI-signed Secure QR
  verifies offline against the committed certificate. Nothing contacts UIDAI,
  and no eKYC API is called.
