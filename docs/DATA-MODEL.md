# Data model

`prisma/schema.prisma`

## The shape of it

```
Farmer ──< Booking >── CapacityDay ──> Centre
   │           │                          │
   │           └──> Lot ──> payment timestamps
   │
   ├──< Delegation >── Aarhtiya
   └──< Notification

Officer ──> Centre        SeasonConfig (MSP, moisture limit)
```

## Why each model exists

### Farmer

Identity plus the two fields that gate everything else: `landAcres` and
`landVerified`. Verified acreage is what caps sellable quantity — the same
principle as Odisha's token quota, but derived from the actual land record
rather than a flat cap, which is precisely the failure that left ~7,000 Bargarh
farmers holding unsellable grain.

`preferredLocale` drives which notification template renders.

### Aarhtiya and Delegation

The commission agent books, transports and often fronts cash. A system that
routes around him gets ignored on the ground, so he is a first-class actor with
an explicit, revocable grant rather than a shared password.

### Centre

Fixed physical characteristics only — weighbridge count, operating hours, yard
capacity. Anything that changes day to day belongs in `CapacityDay`.

### CapacityDay — the important one

The officer's five daily inputs **and** the engine's output, on one row per
centre per day:

| Field | Source |
|---|---|
| `bardanaBags`, `labourGangs`, `trucksAssigned`, `weighbridgeHours`, `openingBacklogQuintals` | Officer input |
| `computedQuintals`, `bindingConstraint`, `breakdown` | Engine output |
| `approvedQuintals` | Officer's override of the computed figure |
| `status` | `DRAFT` until published; only `PUBLISHED` days are bookable |

Keeping input and output on the same row means every published number is
auditable back to the ground conditions that produced it — which matters when a
farmer asks why their slot moved.

`@@unique([centreId, date])` makes the upsert in the capacity route safe.

### Booking

A slot, with the two fields that carry the fairness rules:

- **`seniorityAt`** — preserved across a re-slot. A farmer bumped once does not
  go to the back of the queue when they are bumped again; without this the
  system quietly punishes the people it disrupted.
- **`reslotReason`** — travels with the SMS. An unexplained delay is what sends
  farmers back to sleeping in the queue overnight.

`gatePassCode` is unique and scanned at entry, replacing the paper slip.

### Lot

Everything after the trolley is unloaded. Two groups of fields:

**Quality gate** — `moisturePercent`, `qualityPass`, `rejectionReason`. The
limit itself lives in `SeasonConfig`, not in code, because it differs by crop
(17% paddy, 12% wheat) and can be relaxed by notification in a bad year.

**Payment timestamps** — `jFormIssuedAt`, `liftedAt`, `agencyAckAt`,
`pfmsBatchAt`, `creditedAt`. `paymentStage` is **derived** from these by
`deriveStage()` and stored only as a denormalisation for querying. Nothing
writes a stage directly, so the tracker can never disagree with what happened.

`slaDueAt` is J-form + 72 hours; `slaBreached` is what the admin escalation
screen filters on.

### Notification

One row per channel per event, with `template` recording *which* DLT-registered
template was used. Indian commercial SMS requires pre-approved template bodies,
so the key is operationally meaningful, not just a log label.

### SeasonConfig

MSP per crop per season, and the moisture limit. MSP is notified per season on
CACP's recommendation, so it is configuration a district admin edits — never a
constant in the UI. The J-form route reads it at the moment of issue.

## Enums worth noting

**`BookingStatus`** — `BOOKED → ARRIVED → IN_PROGRESS → COMPLETED`, with
`RESLOTTED`, `NO_SHOW` and `CANCELLED` as exits. `RESLOTTED` is a distinct state
rather than a flag because the farmer panel renders it differently: it carries
an explanation and an instruction not to travel.

**`Constraint`** — `BARDANA | LABOUR | WEIGHBRIDGE | YARD`. Stored on
`CapacityDay` so historical analysis can answer "which resource limited this
district most often last season", which is exactly the question a procurement
officer would want answered before next year's tendering.

**`PaymentStage`** — six values including `AWAITING_JFORM`, ordered so
`stageIndex()` can drive the progress tracker.

## Indexes

Chosen for the three queries the panels actually run:

| Index | Serves |
|---|---|
| `Booking @@index([centreId, status])` | The day-of queue board |
| `Lot @@index([centreId, paymentStage])` | Centre payment view |
| `Lot @@index([slaBreached])` | Admin escalation queue |
| `CapacityDay @@index([date])` | District-wide "who has published today" |

## Commands

```bash
npm run db:push          # apply schema to Neon (uses DIRECT_URL)
npm run db:seed          # a district mid-season
npm run db:studio        # browse the data
npm run db:reset         # wipe and reseed
```
