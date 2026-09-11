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
npm run replay -w @mandi/shared   # fixed quota vs capacity-aware, measured
npm test -w @mandi/shared    # 35 tests — engine, allocator, payment stages, replay
npm test -w @mandi/api       # 15 tests — Aadhaar Secure QR
npm run test:qr -w @mandi/api    # pipeline self-test; --emit prints a sample payload
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
and the API resolves a seeded persona, so UI work is never blocked on
provisioning. `DEMO_ROLE=farmer|officer|admin` picks which one — without it the
officer and admin panels could not be developed with auth off at all. Both are
read from the server environment and reported through `/me`; neither is
settable from a request, because a header would let any client promote itself
to admin.

## Build status

| Step | State |
|---|---|
| 1 · `packages/shared` — types and the socket contract | done |
| 2 · `apps/api` — Prisma schema, `GET /health`, `GET /me` | done |
| 3a · capacity engine, slot allocator, payment stages, seed — 29 unit tests | done |
| 3b · `apps/api` — the REST contract in [API.md](./docs/API.md), all endpoints | done |
| 3c · `apps/api` — Aadhaar Secure QR verification — 15 unit tests | done |
| 4 · `apps/web` — Vite shell, Clerk provider, `/me` guard | done |
| 5a · `apps/web` — farmer panel: dashboard, booking, live queue, payments | done |
| 5b · `apps/web` — centre officer and district admin panels | done |
| 6 · Socket.IO — authenticated handshake, room authorisation, polling fallback | done |
| 7 · PWA — manifest, icons, hand-written service worker, offline gate pass | done |
| 8 · Replay harness — the measured fixed-quota comparison | done |

Each step leaves something runnable, so nobody is blocked on a half-finished
layer.

## Does it actually reduce waiting?

The problem statement's fifth ask is measurable, so it is measured rather than
asserted. `npm run replay -w @mandi/shared` runs one peak-harvest week through
two schedulers — today's flat daily quota, and this one — and prints the
difference. The centre in the scenario loses most of its gunny bags and trucks
on the Wednesday.

| | Fixed daily quota | Capacity-aware |
|---|---|---|
| Wasted journeys | 54 | **17** |
| Slot honour rate | 87.1% | **100%** |
| Mean dwell | 1.54 h | **0 h** |
| Peak yard | 4,200 qtl | **3,914 qtl** |
| Quintals bought | 10,680 | 10,509 |

The Wednesday is the whole argument: the flat quota offers 2,200 quintals at a
centre that can process 600, and 2,284 quintals end up stranded in the yard. The
capacity-aware scheduler offers 587 and tells everyone else before they travel.

Read it honestly, and say so before a panel does: **this is a simulation with
declared assumptions, not field data.** Every input is in `ReplayScenario` to be
challenged, and it is deterministic so any number here can be reproduced. Note
also that the capacity-aware run buys marginally *less* grain across the week,
because it holds a 10% standby reserve — that trade is deliberate, not hidden.

## What is real and what is stubbed

Declaring this boundary matters more than hiding it — examiners punish hidden
mocks far harder than declared ones.

| Real | Stubbed |
|---|---|
| Capacity engine and its constraint maths | Aadhaar eKYC beyond Secure QR signature checks |
| Slot allocation, overbooking, ETA | State land records (Jamabandi / Khasra) |
| Payment state machine and SLA clocks | PFMS payment rail |
| Queue management, re-slotting and realtime push | SMS / IVR delivery — **email via Resend stands in** |
| Aadhaar Secure QR signature verification | — |

### Notifications: email now, SMS in production

The prototype delivers notifications by **email, through Resend**. That is a
deliberate substitution and not a claim that email is the right channel — the
farmers this serves are the least likely to have or check an inbox, and many are
on feature phones where SMS is the only thing that arrives.

The reason is practical: Indian commercial SMS requires a DLT-registered header
and pre-approved template bodies, which takes weeks to obtain and cannot be done
inside a hackathon window. What the swap buys is that the pipeline is **real
rather than stubbed** — templates render per locale (Punjabi, Hindi, English), a
message is actually delivered, and every send is recorded with its outcome.

Everything above the transport already speaks in DLT-shaped template keys, so
moving to SMS is one function, not a rewrite.

Leave `RESEND_API_KEY` blank and messages are still rendered and recorded, just
not delivered — the app runs end to end without a provider account. Note that
Resend's shared sender (`onboarding@resend.dev`) only delivers to the address of
the account that owns the key, so a demo needs `NOTIFY_REDIRECT_TO` pointed at a
real inbox, or a verified domain.

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
