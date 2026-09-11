# Architecture

Two services, one repository, deployed separately.

```
mandi-queue/
├── apps/
│   ├── web/     React SPA          -> Vercel (static + CDN)
│   └── api/     Node REST + Socket -> Railway (one long-lived process)
└── packages/
    └── shared/  Types both sides import
```

## Stack

### `apps/web`

| Layer | Choice | Why |
|---|---|---|
| Build | **Vite** | Dev server starts in under a second; the output is static files a CDN can serve |
| UI | **React 19** + TypeScript strict | |
| Routing | **React Router 7**, data mode | Loaders fetch before the route renders, so a panel never flashes empty |
| Styling | **Tailwind v4** | `@theme` tokens carry over unchanged from the Next build |
| Data | **TanStack Query** | Caching, retries and refetch-on-focus are the bulk of what SSR used to do for us |
| Charts | Recharts | Reads the same `--chart-*` tokens |
| Auth | `@clerk/clerk-react` | Supplies the session JWT to attach to every request |

### `apps/api`

| Layer | Choice | Why |
|---|---|---|
| Runtime | **Node 22** + TypeScript strict | |
| Framework | **Express 5** | Boring on purpose. Every teammate can read it, and the middleware chain maps cleanly onto "authenticate, authorise, validate, handle" |
| Validation | **Zod** | Already the validation layer in the current build; schemas move over untouched |
| Auth | `@clerk/express` | Verifies the Bearer token, exposes `req.auth` |
| Database | **Neon** Postgres + **Prisma** | Schema moves over unchanged |
| Realtime | **Socket.IO** | Now a natural fit: this service is a long-lived process by definition |

### `packages/shared`

Types only, no runtime dependency. The socket event contract, the payment
stage union, and the API response shapes. Both sides import it, so a rename
breaks the build instead of production.

## Why split at all

Recorded honestly, because the previous architecture doc argued the opposite
and the reasoning should not silently disappear.

The old build was one Next.js app: server components queried Prisma inline, and
route handlers covered mutations. That is fewer moving parts and it is why the
first version was built that way.

The split is a deliberate trade:

**Gained** — the frontend deploys to a CDN and the backend to a host that keeps
a process alive, so Socket.IO stops being the thing that dictates where the
whole app runs. The API becomes independently testable with `curl`, and a
teammate can work on React without a database connection string.

**Lost** — server-side rendering. The old doc justified Next with "SSR keeps
first paint fast on a 2G connection", and that is genuinely given up: a farmer
on a weak connection now downloads a JS bundle before seeing anything. Mitigate
it, do not pretend otherwise — keep the bundle small, ship a real loading
skeleton, and let the service worker cache the shell.

**Also lost** — the server-side redirect. Route gates used to run in middleware
and layouts, before any HTML reached the browser. In an SPA the guard runs after
the bundle loads, so an unauthorised user briefly sees a loading state instead
of nothing at all. This is why the API must re-check every rule; see
[API.md](./API.md).

## The three panels

Separate surfaces sharing one database and one API. The boundary that matters
is enforced in `apps/api`, at the route level — never by hiding buttons.

```
/           landing, panel chooser
/farmer     Farmer panel        role: farmer
/centre     Centre panel        role: officer | admin
/admin      Admin panel         role: admin
```

## Request path

```
React component
  -> TanStack Query
  -> fetch(VITE_API_URL + path, { Authorization: Bearer <clerk jwt> })
  -> Express: clerkMiddleware -> requireRole -> zod parse -> handler
  -> Prisma -> Neon
  -> broadcast via Socket.IO if the write changed something a room cares about
```

## Gates

Two gates, both enforced server-side, both mirrored client-side for UX only.

| Gate | Server | Client |
|---|---|---|
| Role | `requireRole("officer")` on the router | Route guard reading `GET /me` |
| Aadhaar | Checked in every farmer handler | Guard redirecting to `/onboarding/verify` |

The client copy exists so nobody stares at a panel that 403s. It is not
security. Deleting it would make the app uglier and no less safe.

## Database connections

Neon needs two connection strings and they are not interchangeable:

| Variable | Host | Used by |
|---|---|---|
| `DATABASE_URL` | contains `-pooler` | The API at runtime — pooled |
| `DIRECT_URL` | same host without `-pooler` | `prisma db push` and `migrate` — DDL over the pooler is unreliable |

Both need `connect_timeout=15`. Neon's free tier suspends the compute after
inactivity, and the first connection has to wake it — measured at 3.8s, 5.0s and
7.5s on this project against Prisma's 5s default. Without the longer timeout the
first request after any idle spell fails, and every screen renders its error
state, which looks exactly like an unseeded database.

Only `apps/api` holds these. The React app has no database credentials, which is
one of the better side effects of the split.

Because the database is shared, `npm run db:reset` wipes **everyone's** data.
Say so in the group chat before running it.

## Deployment

| Service | Host | Root directory | Notes |
|---|---|---|---|
| `apps/web` | Vercel | `apps/web` | Static output; `VITE_*` vars are inlined at build time |
| `apps/api` | Railway | `apps/api` | **One replica.** Socket.IO rooms are in-process; a second replica silently drops half the broadcasts |

Railway injects `PORT` — read it, never hardcode it. CORS on the API allows
exactly the Vercel origin, set from an env var, never `*`.

`VITE_*` values are baked into the bundle at build time, so they must be present
before the build runs, and none of them may be a secret. The Clerk *publishable*
key belongs there; the secret key never leaves `apps/api`.

## Realtime design

Rooms:

| Room | Receives |
|---|---|
| `centre:<id>` | `queue:update`, `capacity:update` |
| `farmer:<id>` | `booking:reslotted`, `payment:stage` |
| `admin` | `admin:escalation` |

Payload shapes live in `packages/shared`, imported by both sides so the contract
cannot drift.

Authenticate the socket handshake. In the current build any client can
subscribe to any farmer's room and receive their slot and payment events; that
bug must not survive the rewrite.

## Build order for the new repo

Each step leaves something runnable, so the team is never blocked on a
half-finished layer.

1. `packages/shared` — types and the socket contract.
2. `apps/api` — Prisma schema and seed moved across, `GET /health`, then
   `GET /me`. Verify with `curl` before any React exists.
3. `apps/api` — the read endpoints in [API.md](./API.md), then the writes. The
   capacity engine, slot allocator and payment stages move over unchanged; they
   are pure functions with no framework coupling.
4. `apps/web` — Vite shell, Clerk provider, the fetch wrapper that attaches the
   token, and the `/me` guard.
5. `apps/web` — panels, one at a time, farmer first.
6. Socket.IO both sides, with an authenticated handshake.
7. PWA: manifest, icons and service worker carry over from the Next build.

## What moves unchanged

These are pure logic with no framework coupling, and should be copied, not
rewritten:

`capacity-engine.ts`, `slot-allocator.ts`, `payment-stages.ts`,
`aadhaar/secure-qr.ts`, `aadhaar/cert-store.ts`, the UIDAI certificate,
`prisma/schema.prisma`, `prisma/seed.ts`, `globals.css` tokens, and every
component under `components/ui` and `components/shared`.

The Tailwind design system carries over verbatim. Nothing in
[design.md](./design.md) changes.

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
