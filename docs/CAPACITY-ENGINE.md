# The capacity engine

`apps/api/src/lib/capacity-engine.ts`

This is the part of the system that no state portal has. Everything else in the
project is table stakes; this is the answer to "doesn't Punjab already have
this?"

## The idea in one paragraph

A procurement centre is a service system with four hard resources. On any given
day the centre can only accept as much grain as its *tightest* resource allows.
Existing portals publish a fixed daily quota that ignores all four, so slots are
promises nobody checked. The engine costs the day against each resource,
takes the minimum, and reports which one binds.

## The four constraints

| Constraint | Formula | Why it caps the day |
|---|---|---|
| **Bardana** | `bags × 0.5 qtl` | Grain cannot leave unbagged. One gunny bag holds 50 kg. |
| **Labour** | `gangs × 350 qtl` | One gang bags and stitches roughly 350 quintals per shift. |
| **Weighbridge** | `(bridges × hours × 60 ÷ 12 min) × 40 qtl` | Every lot is weighed. A serial gate at ~12 min per lot, ~40 qtl per trolley. |
| **Yard** | `capacity − backlog + (trucks × 280 qtl)` | Grain needs floor space. Lifting frees it during the day. |

`sellableQuintals = min(all four)` and `bindingConstraint = argmin`.

## Why reporting the binding constraint matters

A single capacity number tells an officer what they cannot do. Naming the
constraint tells them what to fix. The officer screen renders this as four bars
on one scale, with only the binding one carrying colour — the shape of the chart
is the diagnosis.

It also gives the farmer an honest reason when a slot moves. "Bardana shortage
at the centre" is a sentence someone can act on; "slot unavailable" is not.

## The constants are assumptions, not measurements

They are collected in one exported object precisely so a domain expert can
correct them without touching logic:

```ts
export const OPS = {
  QUINTALS_PER_BARDANA_BAG: 0.5,
  QUINTALS_PER_GANG_PER_DAY: 350,
  WEIGHBRIDGE_MINUTES_PER_LOT: 12,
  AVG_LOT_QUINTALS: 40,
  QUINTALS_PER_TRUCK: 280,
};
```

**Before the presentation:** if you can get district-level observations for any
of these, replace them and say so. A judge who works in procurement will know
whether 350 quintals per gang is plausible, and "we measured this at Sangrur"
beats "we assumed" every time. Where you cannot measure, keep the assumption and
state it — a declared assumption is defensible, a hidden one is not.

## Overbooking and the standby lane

`apps/api/src/lib/slot-allocator.ts`

Capacity is filled by quantity, not head count — twenty small trolleys and four
full trucks are not the same day's work.

- **Standby reserve, 10%** — held back for walk-ins and re-slotted farmers, so
  nobody is turned away at the gate.
- **Overbooking, by exactly the no-show rate (default 8%)** — enough to keep the
  yard busy, not enough to recreate the queue the system exists to remove.

```
offered = sellable × (1 − standbyReserve) ÷ (1 − noShowRate)
```

Both should be learned per centre from history rather than left at the defaults.
That is an obvious and honest "next step" answer if a panel asks.

## The ETA self-corrects

```ts
observedMinutesPerLot = minutesElapsedToday / servedSoFar
```

The estimate uses what the centre has *actually* processed today, not a planning
figure. When the weighbridge goes down, the ETA slides on its own and every
watching farmer sees the new time — with the reason attached, because an
unexplained delay is exactly what sends farmers back to sleeping in the queue.

## Where the engine runs

Twice, deliberately:

1. **In the browser**, live, as the officer types on `/centre/capacity` — so the
   effect of one more truck is visible before anything is saved.
2. **On the server**, in `POST /api/centres/:id/capacity`, as the authority that
   writes `CapacityDay` and triggers re-slotting.

Same pure function both times. It takes plain numbers in and returns a plain
object, which also makes it trivial to unit-test and to replay a synthetic
arrival profile through.

## Proving it works

The success criterion in the problem statement — "reduces congestion and waiting
time" — is measurable, so measure it. Replay one plausible arrival profile (a
peak-week surge into a centre with a fixed weighbridge and a bardana shortfall
on day three) through two schedulers: today's fixed daily quota, and this one.

| Metric | What a win looks like |
|---|---|
| Mean dwell time (gate-in → J-form) | Falls, and the long tail falls further than the mean |
| Slot honour rate (served within 60 min of promise) | The headline number — trust is built here |
| Peak yard occupancy | Flatter curve, no overnight overflow |
| Wasted trips (rejected on moisture or capacity) | Near zero — pre-arrival checks caught them |
| Payment SLA breaches | Surfaced with an owner, not silently absorbed |

The admin dashboard charts the first of these. Wiring the replay harness so the
comparison runs live from seeded data is the highest-value remaining task.

## What the engine does not claim

It does not fix lifting delays, bardana procurement or truck tendering. It makes
those constraints visible, schedules honestly around them, and attaches a clock
and an owner. Say this before a panel says it for you.
