# Authentication and verification

Three different things get conflated constantly. They are separate layers, and
Clerk only provides the first.

| Layer | Question it answers | Provided by |
|---|---|---|
| Authentication | Does this person control this phone number? | **Clerk** |
| Identity proofing | Is this human who they claim to be? | **Aadhaar Secure QR** |
| Entitlement | What may this verified person sell, and how much? | **Land record** |

## Clerk

Sign-in is by **phone number + OTP**, which is what farmers actually have.

Clerk is optional by design. With `VITE_CLERK_PUBLISHABLE_KEY` blank in
`apps/web` and `CLERK_SECRET_KEY` blank in `apps/api`, both run in **demo
mode**: every panel is open and the API resolves the first seeded farmer, so UI
work is never blocked on provisioning. Fill the keys in and the same code paths
resolve the real session. The nav shows a `demo mode` badge whenever auth is
off, so nobody mistakes one for the other.

Demo mode must be decided by the **API**, not the browser. If the React app
alone decided, anyone could flip it with a devtools edit. `GET /me` reports it,
and every handler honours the same flag.

### Enable India in the SMS allowlist, per instance

Sign-in fails with *"Phone numbers from this country (India) are currently not
supported"* (`unsupported_country_code`, HTTP 403) until India is switched on.
This is **not** a Clerk-wide limitation: every instance ships with an SMS
country allowlist that has only the US and Canada enabled, so Clerk refuses to
send an OTP to a `+91` number.

Clerk dashboard → **SMS** → **Settings** tab → enable **India**
(<https://dashboard.clerk.com/~/customization/sms>). It is available on the
development instance; phone as an identifier needs a paid plan in production.

**The allowlist is per instance, and per application.** Dev and production each
have their own, and a newly created Clerk application starts over at US +
Canada — so spinning up a fresh app to escape this error re-introduces it.

Which instance a running server is actually talking to is checkable, and worth
checking before blaming the dashboard:

```bash
curl -s http://localhost:5173/ | grep -oE 'pk_test_[A-Za-z0-9]+' | sort -u
# built bundle, or a deployed site:
grep -rhoE 'pk_test_[A-Za-z0-9]+' apps/web/dist/assets/*.js | sort -u
```

Decode the part after `pk_test_` with base64 and you get the frontend API host,
e.g. `current-urchin-7803.clerk.accounts.dev`. If that is not the instance
whose dashboard you just edited, **restart the dev server**: `VITE_*` values
are inlined at build time, so editing `.env` under a running Vite server changes
nothing in the browser.

The same rule bites harder in production. If `VITE_CLERK_PUBLISHABLE_KEY` is
missing when the bundle is built, the app ships in demo mode — auth off, every
panel open — with no error to warn you. Verify a deploy with the grep above
before showing anyone the link.

India was enabled on this project's development instance by Clerk support on
**2026-09-10**, so the toggle is already done here — but a teammate creating
their own Clerk application will hit the error again and has to redo it.

Two limits that bite right after:

- A development instance (`pk_test_…`) caps Clerk-delivered SMS at **20 per
  month**. For anything repetitive use Clerk's test numbers — `+1 (XXX)
  555-0100` through `555-0199`, verified with the code `424242`. No SMS is
  sent and they do not count against the cap, which makes them the right way to
  work through the panels day to day.
- Indian commercial SMS requires DLT-registered headers. That is Clerk's
  problem for OTP delivery, but ours for the notification SMS the app sends
  itself (see `TWILIO_*` in `.env.example`).

### Budget the 20 live messages

Clerk's test numbers are **US-format** (`+1 … 555-01XX`). They authenticate
fine, but they cannot show a `+91` number on screen — so they are no good for
the one moment in a demo where a farmer's real Indian phone matters.

Practical split: do all development and rehearsal on test numbers, and keep the
20 live messages for the live demo itself. Twenty disappears faster than it
sounds once three people are each testing sign-up.

Note this cap applies **only to Clerk's sign-in OTP**. The app's own
notifications — slot confirmed, re-slotted, moisture failure, payment credited
— go through our provider in `apps/api/src/lib/notifications.ts`, not Clerk, and are
currently logged to the console. Demonstrating those costs nothing.

### Production SMS: bring your own provider

In production, enabling India in the dashboard means Clerk delivers the OTP and
forwards per-country SMS costs onto the bill
(<https://clerk.com/pricing?sms-rates=true>).

The better answer here is to send it ourselves. Clerk supports disabling
*"Delivered by Clerk"* on SMS templates, after which it emits a webhook instead
of sending, and the handler dispatches through whatever provider we like
(<https://clerk.com/docs/guides/customizing-clerk/email-sms-templates#delivered-by-clerk>
— confirm the exact event name against current docs before wiring it).

That matters because **this project already needs a DLT-registered Indian SMS
provider** for its own notifications. Routing Clerk's OTP through the same one
means a single provider, a single DLT registration, one set of approved
template bodies, and no per-country markup — rather than two SMS paths with
separate compliance stories. Worth saying out loud if a panel asks how this
survives contact with production.

### Roles

Roles live in Clerk `publicMetadata.role`: `farmer` | `officer` | `admin`.

**Only `farmer` is self-assignable**, at `POST /api/v1/onboarding`. Officer and
admin are granted by a person in the Clerk dashboard — a public form that hands
out officer rights would let anyone publish a centre's capacity and re-slot real
farmers.

Enforcement is a `requireRole()` middleware on the Express router, and nowhere
else. The React app mirrors it as a route guard so nobody stares at a panel that
403s, but that guard is cosmetic: it ships in a bundle the user controls.

To promote an account: Clerk dashboard → Users → the user → Metadata → Public,
then set:

```json
{ "role": "officer" }
```

### How the token crosses the origin boundary

The web app and the API are on different origins, so the session cannot ride on
a cookie. It rides on the `Authorization` header instead, which is simpler and
has no SameSite problems:

1. `@clerk/clerk-react` holds the session in `apps/web`.
2. Every request goes through one fetch wrapper that calls Clerk's
   `getToken()` and attaches `Authorization: Bearer <jwt>`.
3. `@clerk/express` verifies it on the API and populates `req.auth`.

Token verification is a **local signature check** against Clerk's cached JWKS —
no network call per request. That is the main reason this design is faster than
the one it replaces.

Put the fetch wrapper in exactly one module. A second place that calls `fetch`
directly is a second place to forget the header, and it will fail as a confusing
401 rather than an obvious mistake.

CORS on the API allows exactly the web origin, read from an env var. Never `*` —
with `*` any page on the internet can call the API with a token it phished.

### One dashboard step worth doing

By default Clerk's session token does **not** carry `publicMetadata`, so the API
cannot read the role from the token and has to fall back to a Clerk Backend API
lookup. That costs a network round trip — measured at 3912ms on a first call
here, against 424–1139ms warm.

To avoid it: Clerk dashboard → Sessions → **Customize session token**, add:

```json
{ "metadata": "{{user.public_metadata}}" }
```

Read `sessionClaims.metadata.role` first and fall back only when it is absent,
so this stays an optimisation rather than a requirement.

**It used to be load-bearing, and that was a bug worth not repeating.** In the
Next build the fallback redirected to `/onboarding` to resolve the role
server-side. But `/onboarding` resolved it, found a complete profile, and
forwarded to `/farmer` — which arrived back at a gate that still could not read
the role, and redirected to `/onboarding` again. Any account whose role the
token did not carry looped until Chrome killed the navigation and rendered a
blank page.

Two rules keep it from coming back, and both apply to the new API:

- **One resolver, called by everything.** Whatever decides a role must not
  delegate the decision to something that can redirect back into it.
- **Absent roles are never cached.** Cache a resolved role for 60s per user if
  you like, but caching *the absence* of one bounces a farmer straight back to
  onboarding in the seconds after onboarding granted it.

A role changed in the Clerk dashboard therefore takes up to a minute to apply.

### When Clerk or the database does not answer

Both are network calls, and on a slow link or a cold start either fails
intermittently. The rule that matters: **a failed lookup is not the same as a
negative answer.**

`GET /me` returns 503 when it cannot resolve the user, never `role: null`.
Collapsing the two is what turned an outage into a redirect loop last time: the
client reads "no role", sends the user to onboarding, onboarding asks again,
and round it goes. On a 503 the client shows a retry panel and stays put.

Neon's free tier suspends the compute after inactivity, and the first connection
after that outlasts Prisma's 5s default connect timeout — measured here failing
at 5028ms, then succeeding at 3709ms, 3821ms and 7487ms once awake. Both URLs
carry `connect_timeout=15`. Without it the first request after any idle spell
fails, and every screen renders its error state, which looks exactly like an
unseeded database.

## The verification chain

No single signal is strong enough on its own. Four weak ones chain into
something defensible:

| Step | What it establishes | Status |
|---|---|---|
| Clerk phone OTP | they control this phone number | built |
| Secure QR signature | UIDAI issued this identity, unaltered | built |
| `mobileHash` match | this phone belongs to *that* identity | not built |
| Land record name match | what they are entitled to sell | not built |

Step 2 alone proves the **document** is genuine — never that the person
presenting it owns it. Step 3 is what closes that gap: the QR carries a
SHA-256 hash of the registered mobile, so the phone Clerk just verified can be
tested against the one UIDAI holds. Confirm the exact hashing construction
against UIDAI's Secure QR specification before relying on it.

## Aadhaar Secure QR

See `apps/api/src/lib/aadhaar/secure-qr.ts` and its `certs/README.md`.

It lives in the API and only there. Verification must never run in the browser:
a client that decides its own Aadhaar is valid is not a check, and the bundle is
editable by the person being checked.

Runs **entirely offline** — no UIDAI API, no AUA/KUA licence, no network call
to any government server. Only a public certificate on disk. "Offline" here
means *UIDAI is never contacted*, not that the farmer's phone works without a
network: verification happens server-side and must stay there, because
client-side verification is theatre.

What is stored: the last four digits, the reference ID, name, DOB, district,
whether the signature verified, and which certificate matched. **Never an
Aadhaar number** — the QR does not contain one, so the UIDAI Data Vault
requirement never applies.

`npm run test:qr` exercises the whole pipeline and prints which certificates
are installed. `npm run test:qr -- --emit` prints a sample payload for testing
the scanner's paste box; it always reports NOT VERIFIED, because it is not
signed by UIDAI.

## Security rules this codebase follows

- **Identity comes from the session, never the request body.** Every handler
  resolves the farmer from `req.auth`. Accepting a `farmerId` from the client
  would let any signed-in user consume someone else's seasonal quota or attach a
  scan to another person's record. This matters more after the split, not less:
  the client is now a separate program that an attacker fully controls.
- **The React app enforces nothing.** Its role and Aadhaar guards exist so
  nobody stares at a screen that 403s. Every rule is re-checked in the API,
  which is the only place a check cannot be edited out.
- **Unverified never renders as verified.** If no UIDAI certificate is
  installed, scans still parse but `signatureVerified` stays false and the
  farmer stays unverified. A missing certificate cannot silently upgrade an
  unchecked scan.
- **Unknown role is not "allowed".** The API resolves the role itself and
  fails closed with a 503 when it cannot — never letting the request through,
  and never reporting "no role", which turns an outage into a redirect loop on
  the client.
- **Only the three known roles grant anything.** `publicMetadata.role` is
  matched against `farmer | officer | admin` and anything else reads as no
  role, so a stray or hand-edited metadata value cannot open a panel.

## Still open

Tenant cultivators — a large share of actual sellers do not own the land they
farm. If ownership matching is a hard requirement, the system excludes exactly
the most vulnerable farmers, which is the Bargarh failure in a new form. The
intended design is a confidence-scored name match: high confidence
auto-verifies, low confidence routes to the centre officer for attestation,
never a silent rejection. `VerificationMethod.OFFICER_ATTESTATION` exists in
the schema for this; the flow is not built.
