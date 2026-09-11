# SIH 26032 — Mandi Queue

**Problem statement:** Farmers often face long waiting times, lack of information
regarding procurement schedules, and uncertainty about procurement status.

**Organisation:** Ministry of Consumer Affairs, Food & Public Distribution
**Department:** Department of Consumer Affairs (DoCA)
**Category:** Software · Smart Automation

## What the statement asks for

A platform that:

1. Enables farmer registration and slot booking
2. Provides real-time queue management
3. Sends SMS / app notifications
4. Tracks procurement and payment status
5. Reduces congestion and waiting time at procurement centres

## The finding that shapes this build

Every one of those five deliverables already ships somewhere in production.

| Ask | Already live in |
|---|---|
| Registration + slot booking | MP e-Uparjan (OTP self-service), Punjab Anaaj Kharid (gate pass with date/time) |
| SMS notifications | Haryana Meri Fasal Mera Byora pushes procurement dates by SMS |
| Payment tracking | e-Kharid + PFMS/DBT, with a 72-hour norm from the J-form |
| Token / quota control | Odisha P-PAS, tokens tied to registered acreage |

And yet farmers holding valid tokens still queue for days. The reason is that
**none of these systems schedules against what the centre can physically
process.** The wait is not caused by bad booking UX; it is caused by resources
running out:

- **Lifting backlog** — one district reported 12 of 42 centres fully
  operational, transport tenders uncleared, trucks short. Yard space is the real
  daily capacity, and lifting is also what releases payment.
- **Bardana and labour** — bagging stops when gunny bags or stitching gangs run out.
- **Moisture** — FCI caps paddy at 17%; in a bad year much of the crop arrives
  above 20%, so farmers burn a slot and occupy a bay while drying.
- **Quota vs. actual yield** — in Bargarh, roughly 7,000 farmers' tokens were
  blocked because the permitted quantity sat below what they had grown.

## So what this project actually builds

A **capacity engine** that models each centre as a service system — weighbridge
minutes, labour gangs, bardana on hand, free yard area, trucks assigned — and
issues slots only against capacity the centre can honour, re-slotting farmers
*before they travel* when that capacity moves.

The other four asks are built too, and built well. But they are the table
stakes; the capacity engine is the answer to "doesn't Punjab already have this?"

## What must not be claimed

Software cannot fix lifting delays. It can make the constraint visible, schedule
around it, and put an SLA clock and a named owner on it. Claiming more is how
teams lose credibility in front of a DoCA panel.

## Related documents

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | The two services, what moves where, build order |
| [API.md](./API.md) | The REST contract between web and api |
| [AUTH.md](./AUTH.md) | Clerk, cross-origin tokens, the verification chain |
| [FEATURES.md](./FEATURES.md) | Feature list per panel, prioritised |
| [FLOW.md](./FLOW.md) | End-to-end flow from registration to bank credit |
| [DATA-MODEL.md](./DATA-MODEL.md) | Every model and why it exists |
| [CAPACITY-ENGINE.md](./CAPACITY-ENGINE.md) | The differentiator, in detail |
| [design.md](./design.md) | Notion design system reference |
