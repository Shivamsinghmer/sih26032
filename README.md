# Mandi Queue — SIH 26032

Capacity-aware slot booking, queue management and payment tracking for
agricultural procurement centres.

**Problem statement:** Farmers often face long waiting times, lack of
information regarding procurement schedules, and uncertainty about procurement
status.
**Organisation:** Ministry of Consumer Affairs, Food & Public Distribution ·
Department of Consumer Affairs (DoCA) · Software · Smart Automation

## Why this is not another booking portal

All five deliverables in the problem statement already ship somewhere in
production — MP e-Uparjan books slots, Haryana's Meri Fasal Mera Byora sends
SMS, e-Kharid and PFMS track payment, Odisha's P-PAS issues tokens against
acreage. And farmers holding valid tokens still queue for days.

The reason is that **none of those systems schedules against what the centre can
physically process.** Bagging stops when gunny bags run out. Weighing stops when
the bridge is busy. Yard space runs out when lifting falls behind. A slot issued
against a flat daily quota is a promise nobody checked.

This project builds a **capacity engine** that models each centre as a service
system — bardana, labour gangs, weighbridge minutes, free yard area — and issues
slots only against capacity the centre can honour, re-slotting farmers *before
they travel* when that capacity moves.

What it does **not** claim: software cannot fix lifting delays, bardana
procurement or truck tendering. It makes those constraints visible, schedules
honestly around them, and attaches an SLA clock and a named owner.

## Repository layout

```
mandi-queue/
├── apps/
│   ├── api/      Node 22 · Express 5 · Prisma · Socket.IO   -> Railway
│   └── web/      Vite · React 19 · Tailwind v4              -> Vercel   (not yet built)
├── packages/
│   └── shared/   Types and the socket contract, imported by both sides
└── docs/         The specification this is built from
```

`packages/shared` carries the API response shapes, the domain vocabulary, the
Socket.IO event contract — and the capacity engine. Both services import it, so
a rename breaks the build instead of production.

The engine lives there rather than in the API because it runs **twice**, on
purpose: in the browser as the officer types, so the effect of one more truck is
visible before anything is saved, and on the server as the authority that writes
`CapacityDay` and triggers re-slotting. Two implementations of that would be one
too many. It is a pure function of plain numbers with no imports, which also
makes it trivial to unit-test and to replay an arrival profile through.

```bash
npm test -w @mandi/shared
```

## Getting started

```bash
npm install
cp apps/api/.env.example apps/api/.env    # then fill it in
npm run db:push                           # apply the schema
npm run db:seed                           # a district mid-season
npm run dev:api
curl localhost:4000/health
```

`GET /health` returns `{ ok, db, dbLatencyMs, demoMode }`. A `dbLatencyMs` in the
thousands on the first call is a cold Neon compute waking up, not a fault.

### Environment

Neon needs **two** connection strings and they are not interchangeable:
`DATABASE_URL` is the pooled host (contains `-pooler`) and is what the API uses
at runtime; `DIRECT_URL` is the same host without it, used by `prisma db push`,
because DDL over the pooler is unreliable. Both must carry `connect_timeout=15` —
Neon's free tier suspends the compute and the first wake outlasts Prisma's 5s
default. `apps/api/src/env.ts` warns at boot if either rule is broken.

**Demo mode.** Leave `CLERK_SECRET_KEY` blank and auth is off: every panel opens
and the API resolves the first seeded farmer, so UI work is never blocked on
provisioning. Demo mode is decided by the API and reported through `/me` — if the
browser decided, anyone could flip it in devtools.

## Build status

| Step | State |
|---|---|
| 1 · `packages/shared` — types and the socket contract | done |
| 2 · `apps/api` — Prisma schema, `GET /health`, `GET /me` | done |
| 3a · capacity engine, slot allocator, payment stages, seed — 29 unit tests | done |
| 3b · `apps/api` — the rest of the REST contract in [API.md](./docs/API.md) | next |
| 4 · `apps/web` — Vite shell, Clerk provider, `/me` guard | not started |
| 5 · `apps/web` — the three panels, farmer first | not started |
| 6 · Socket.IO, with an authenticated handshake | not started |
| 7 · PWA — manifest, icons, service worker | not started |

Each step leaves something runnable, so nobody is blocked on a half-finished
layer.

## What is real and what is stubbed

Declaring this boundary matters more than hiding it — examiners punish hidden
mocks far harder than declared ones.

| Real | Stubbed |
|---|---|
| Capacity engine and its constraint maths | Aadhaar eKYC beyond Secure QR signature checks |
| Slot allocation, overbooking, ETA | State land records (Jamabandi / Khasra) |
| Payment state machine and SLA clocks | PFMS payment rail |
| Queue management and realtime push | SMS / IVR delivery (logs to console) |
| Aadhaar Secure QR signature verification | — |

## Security posture

- **The API is the only security boundary.** Every guard in the React app exists
  so a user does not see a screen that will fail. None of it is trusted.
- **Identity comes from the session, never the request body.** A handler that
  accepted a `farmerId` would let any signed-in user consume someone else's
  seasonal quota.
- **A failed lookup is not a negative answer.** `GET /me` returns 503 when it
  cannot resolve the user, never `role: null` — collapsing the two turns an
  outage into an infinite onboarding redirect.
- **Unverified never renders as verified.** With no UIDAI certificate installed,
  scans still parse but the farmer stays unverified.

## Documentation

| Document | Contents |
|---|---|
| [PROJECT.md](./docs/PROJECT.md) | The problem statement and the finding that shapes the build |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | The two services, what moves where, build order |
| [CAPACITY-ENGINE.md](./docs/CAPACITY-ENGINE.md) | The differentiator, in detail |
| [API.md](./docs/API.md) | The REST contract between web and api |
| [AUTH.md](./docs/AUTH.md) | Clerk, cross-origin tokens, the verification chain |
| [DATA-MODEL.md](./docs/DATA-MODEL.md) | Every model and why it exists |
| [FLOW.md](./docs/FLOW.md) | End-to-end, registration to bank credit |
| [FEATURES.md](./docs/FEATURES.md) | Feature list per panel, prioritised |
| [design.md](./docs/design.md) | The design system |

## Licence

MIT — see [LICENSE](./LICENSE).
