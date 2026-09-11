# REST API

The contract between the two services. `apps/web` (React) knows nothing about
Postgres; `apps/api` (Node) knows nothing about routing or layout.

Base URL comes from `VITE_API_URL` on the web side. Every path below is
prefixed `/api/v1`. Versioning from day one costs nothing and means a breaking
change never has to be coordinated across two deploys in one evening.

## Conventions

| | |
|---|---|
| Auth | `Authorization: Bearer <Clerk session JWT>` on every route except `/health` |
| Content type | `application/json` both ways |
| Dates | ISO 8601 strings, UTC. The client formats for `en-IN`; the server never does |
| Money | Integer paise. Never a float — `18.10` has no exact binary representation |
| Quantities | Quintals, `number`, one decimal place |
| Errors | `{ "error": "<human sentence>", "code": "<machine_slug>" }` |

Status codes carry meaning, and the client branches on them:

| Code | Means | Client does |
|---|---|---|
| 400 | Body failed validation | Show the message against the form |
| 401 | No or invalid token | Redirect to sign-in |
| 403 | Authenticated, wrong role | Redirect to the panel they do have |
| 409 | Conflict — slot gone, phone taken | Re-fetch and show what changed |
| 422 | Well-formed but unprocessable — a QR that will not parse | Show the message |
| 503 | Database or Clerk unreachable | Show the retry panel |

**The API is the only security boundary.** Every guard in the React app exists
so a user does not see a screen that will fail. None of it is trusted. A farmer
who edits their own bundle to skip a check reaches an endpoint that checks
again, server-side, against the session — never against an id in the request
body.

## Identity

### `GET /me`

The first call the web app makes once Clerk reports a session. Everything the
router needs to decide which panel — and which gate — the user belongs to.

```jsonc
{
  "userId": "user_3J9...",
  "role": "farmer",              // farmer | officer | admin | null
  "gates": {
    "hasProfile": true,          // false -> /onboarding
    "aadhaarVerified": false     // false -> /onboarding/verify
  },
  "farmer": {                    // present when role=farmer and hasProfile
    "id": "clx...", "name": "...", "village": "...", "district": "...",
    "state": "...", "landAcres": 2.5, "landVerified": false,
    "preferredLocale": "pa"
  },
  "officer": null                // present when role=officer|admin
}
```

`role: null` with `hasProfile: false` is a fresh account. `role: null` because
the lookup *failed* must return 503 instead. Collapsing those two is what made
the old build loop: an outage read as "new user" and bounced people back into
onboarding forever.

## Onboarding

### `POST /onboarding`

Creates the farmer profile and self-assigns the `farmer` role. Only `farmer` is
self-assignable — officer and admin are granted by a person in the Clerk
dashboard, because a public form that hands out officer rights would let anyone
publish a centre's capacity.

```jsonc
// request
{ "name": "...", "village": "...", "district": "...", "state": "...",
  "preferredLocale": "pa" }       // hi | pa | en
// 201
{ "farmer": { } }
```

The phone comes from the Clerk session, never the body. 409 if that phone
already belongs to a farmer.

### `POST /verify/aadhaar`

```jsonc
// request
{ "qrPayload": "6376293610495882736..." }   // raw digit string off the QR
// 200
{ "signatureVerified": true,
  "certificateFile": "uidai_offline_publickey_2026.cer",
  "message": "...",
  "identity": { "name": "...", "dateOfBirth": "...", "gender": "...",
                "district": "...", "state": "...", "pincode": "...",
                "aadhaarLast4": "7058" } }
```

Verification runs on the server and only there — client-side verification is
theatre, since anyone can skip it. The client's only job is to read the QR and
post the string.

A parsed-but-unsigned payload returns 200 with `signatureVerified: false`: the
farmer stays unverified, and the identity is returned only so an officer can see
what was read. 422 if the payload will not parse at all.

The photo embedded in the QR is deliberately never returned. Nothing in this
flow needs it.

## Farmer

| Method | Path | Replaces |
|---|---|---|
| `GET` | `/farmer/dashboard` | `(farmer)/farmer/page.tsx` |
| `GET` | `/farmer/lots` | `(farmer)/farmer/payments/page.tsx` |
| `GET` | `/farmer/queue-context` | `(farmer)/farmer/queue/page.tsx` |
| `GET` | `/centres` | the booking form's centre list |
| `GET` | `/slots?centreId=&date=` | existing route handler |
| `POST` | `/bookings` | existing route handler |

### `GET /farmer/dashboard`

```jsonc
{ "nextBooking": { "id": "...", "tokenNumber": 14, "slotStart": "...",
                   "status": "RESLOTTED", "reslotReason": "...",
                   "quantityQuintals": 42.5,
                   "centre": { "id": "...", "name": "..." } },
  "latestLot":  { "id": "...", "stage": "J_FORM_ISSUED",
                  "slaBreached": false, "amountPaise": 1234500,
                  "jFormIssuedAt": "..." } }
```

Both keys are `null` when there is nothing outstanding.

`stage` is derived server-side from timestamps by `deriveStage()`. It is never
stored, and never computed on the client — two implementations of one state
machine is one too many.

### `POST /bookings`

```jsonc
{ "centreId": "...", "slotStart": "...", "quantityQuintals": 42.5,
  "crop": "PADDY" }
```

The farmer comes from the session. Accepting a `farmerId` here would let any
signed-in user consume someone else's seasonal quota — the single most
important rule in this API.

409 when capacity moved underneath the request. The body names what changed, so
the client can re-render the day rather than show a bare failure.

## Centre — role `officer` or `admin`

| Method | Path | Replaces |
|---|---|---|
| `GET` | `/centres/:id/today` | `(centre)/centre/page.tsx` |
| `GET` | `/centres/:id/capacity?date=` | `(centre)/centre/capacity/page.tsx` |
| `POST` | `/centres/:id/capacity` | existing route handler |
| `GET` | `/centres/:id/queue` | existing `/api/queue/:centreId` |
| `POST` | `/queue/advance` | existing route handler |
| `POST` | `/lots` | existing route handler |
| `PATCH` | `/lots/:id/stage` | existing route handler |

### `GET /centres/:id/today`

```jsonc
{ "centre": { },
  "capacityDay": { },
  "bookingsToday": [ ],
  "breachedLots": [ { "id": "...", "farmerName": "...", "stage": "...",
                      "hoursOverdue": 19 } ],
  "awaitingLift": 7 }
```

### `POST /centres/:id/capacity`

Publishing a day is what makes it bookable. Until then it is a draft and no
farmer sees it. The response carries the engine's verdict, so the officer reads
the same numbers the farmer will:

```jsonc
{ "sellableQuintals": 1840, "bindingConstraint": "BARDANA",
  "explanation": "...",
  "reslotted": [ { "bookingId": "...", "farmerId": "..." } ] }
```

Re-slotting on publish is the point of the whole system: the farmer learns at
home, not at the gate. Every entry in `reslotted` fires a notification.

## Admin — role `admin`

| Method | Path | Replaces |
|---|---|---|
| `GET` | `/admin/overview` | `(admin)/admin/page.tsx` |
| `GET` | `/admin/escalations` | `(admin)/admin/escalations/page.tsx` |

### `GET /admin/escalations`

Every lot past the 72-hour payment norm, with the stage it is stuck at and the
office accountable for it:

```jsonc
[ { "lotId": "...", "farmer": { "name": "...", "phone": "...",
                                "village": "..." },
    "centre": { "name": "..." }, "jFormIssuedAt": "...",
    "amountPaise": 1234500, "stage": "AWAITING_LIFT",
    "owner": "...", "hoursOverdue": 19 } ]
```

`owner` comes from `ownerOf(stage)`. An escalation without a named office is
just a complaint.

## Realtime

Socket.IO on the API service, path `/api/socket`. The event contract lives in a
package both services import, so it cannot drift:

| Room | Events |
|---|---|
| `centre:<id>` | `queue:update`, `capacity:update` |
| `farmer:<id>` | `booking:reslotted`, `payment:stage` |
| `admin` | `admin:escalation` |

Client to server: `centre:subscribe` / `centre:unsubscribe`,
`farmer:subscribe`, `admin:subscribe`.

Two faults in the current build that the rewrite must not carry over:

- **Rooms are unauthenticated.** Any connected socket can call
  `farmer:subscribe` with any id and receive another farmer's slot and payment
  events. The new server must verify the Clerk token on connect and refuse a
  room that does not belong to the caller.
- **There is no polling fallback**, despite a code comment claiming one. When
  the socket is down the queue board silently freezes at first paint. Either
  build the fallback or render a disconnected state — a stale queue position
  sends a farmer to the mandi at the wrong hour.

## Health

### `GET /health`

Unauthenticated. `{ "ok": true, "db": "up" }`. Railway uses it for health
checks, and it is the fastest way to tell a cold Neon compute from a broken
deploy.
