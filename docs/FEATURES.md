# Features by panel

Priorities assume a hackathon build window.
**must** = demo-critical · **should** = strengthens the pitch · **could** = roadmap

Status reflects what was **built and working in the Next.js build**, which is
the thing being ported. In the new two-service repo, treat every "Built" row as
*specified and proven, not yet migrated* — the behaviour is known, the code
exists to copy from, and [ARCHITECTURE.md](./ARCHITECTURE.md) says what moves
unchanged versus what has to be rewritten against the API.

Port in the order given by the priority column: every **must** row before any
**should** row. The capacity engine rows carry the pitch and have zero
framework coupling, so they are also the cheapest to move.

## Farmer panel — PWA + SMS/IVR fallback

| Feature | Priority | Status |
|---|---|---|
| Registration & eKYC (Aadhaar + land record) | must | Model in place, verification stubbed |
| Capacity-aware slot booking | must | Built — `/farmer/book` |
| Proactive re-slot before travel | must | Built — `reslotOverflow()` |
| Live queue position & moving ETA | must | Built — `/farmer/queue` |
| Digital gate pass | must | Built — code issued on booking |
| Notifications (SMS / push / IVR) | must | Built — **email via Resend** in the prototype; SMS needs DLT registration |
| Payment tracker, five stages | must | Built — `/farmer/payments` |
| Defer slot without losing seniority | should | `seniorityAt` in place, UI not built |
| Delegate to an aarhtiya | should | Model in place, UI not built |
| Pre-arrival moisture guidance | should | Copy shown on booking and dashboard |
| Language toggle | must | Templates are multi-locale; UI toggle not built |
| Raise an issue | could | Not built |

## Centre officer panel — desktop web

| Feature | Priority | Status |
|---|---|---|
| Daily capacity input (5 numbers) | must | Built — `/centre/capacity` |
| Computed sellable capacity + binding constraint | must | Built — live as you type |
| Day-of queue board | must | Built — `/centre/queue` |
| Call next / mark arrived / no-show | must | Built |
| Quality check entry with auto re-slot on failure | must | Built |
| Digital J-form issuance | must | Built — starts the payment clock |
| Lifting status update | must | API built — `POST /api/lots/:id/stage` |
| Standby / walk-in lane | should | Reserve calculated, UI not built |
| Broadcast to today's queue | should | Not built |
| SLA breach view for this centre | should | Built — `/centre` |

## District admin panel — desktop web

| Feature | Priority | Status |
|---|---|---|
| Multi-centre dashboard | must | Built — `/admin` |
| Aggregate KPIs | must | Built |
| Escalation queue with owner + clock | must | Built — `/admin/escalations` |
| Season & MSP configuration | should | Model in place, UI not built |
| Centre comparison & trends | should | Occupancy chart built; trends not |
| Staff & role management | should | Model in place, UI not built |
| Audit export | could | Not built |

## The highest-value remaining work

1. **The replay harness.** Run one arrival profile through the fixed-quota
   scheduler and the capacity-aware one, and chart the difference. This turns
   ask (v) from a claim into a measured result and is the single strongest thing
   left to build.
2. **The IVR flow.** Even a scripted demo from a real handset answers the
   equity question better than any slide.
3. **Language toggle in the UI.** The templates are already multi-locale; the
   panel is not.
