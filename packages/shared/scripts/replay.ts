/**
 * `npm run replay -w @mandi/shared`
 *
 * Runs the peak-week scenario through both schedulers and prints the
 * comparison. Deterministic, so the numbers on a slide can be reproduced by
 * anyone who doubts them.
 */

import { replay, peakWeekScenario, formatComparison } from "../src/engine/replay.js";

const scenario = peakWeekScenario();
const result = replay(scenario);

console.log("Replay — peak harvest week, one centre\n");
console.log("Scenario (every assumption is here to be challenged):");
console.log(`  centre        ${scenario.centre.weighbridgeCount} weighbridges, ${scenario.centre.yardCapacityQuintals} qtl yard, ${scenario.centre.openHours}h day`);
console.log(`  arrivals      ${scenario.arrivalsQuintals.join(", ")} qtl`);
console.log(`  fixed quota   ${scenario.fixedQuotaQuintals} qtl/day, published regardless of conditions`);
console.log(`  moisture      ${(scenario.moistureFailureRate * 100).toFixed(0)}% of arrivals fail, charged to BOTH schedulers`);
console.log(`  the shortfall Wed — bardana down to ${scenario.days[2]!.bardanaBags} bags, trucks down to ${scenario.days[2]!.trucksAssigned}\n`);

console.log(formatComparison(result));

console.log("\nWhat changed");
console.log(`  ${result.delta.wastedTripsAvoided} wasted journeys avoided`);
console.log(`  slot honour rate up ${result.delta.honourRatePoints} points`);
console.log(`  mean dwell down ${result.delta.dwellHoursSaved} hours`);
console.log(`  peak yard down ${result.delta.peakYardReduction} qtl`);

console.log("\nThe Wednesday, day by day");
for (const [i, day] of result.fixedQuota.perDay.entries()) {
  const aware = result.capacityAware.perDay[i]!;
  console.log(
    `  ${day.label}  centre could do ${String(day.sellableQuintals).padStart(6)} qtl` +
      `  ·  quota offered ${String(day.offeredQuintals).padStart(6)} → yard ${String(day.yardQuintals).padStart(6)}` +
      `  ·  capacity-aware offered ${String(aware.offeredQuintals).padStart(6)} → yard ${String(aware.yardQuintals).padStart(6)}`,
  );
}

console.log(
  "\nRead honestly: this is a simulation with declared assumptions, not field data.\n" +
    "It shows that scheduling against a centre's actual resources wastes fewer journeys\n" +
    "than a flat quota under the stated conditions. It does not claim a measured\n" +
    "real-world result, and the capacity-aware run buys marginally LESS grain over the\n" +
    "week because it holds a 10% standby reserve — that trade is deliberate.",
);
