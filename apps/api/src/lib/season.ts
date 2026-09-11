/**
 * Season configuration lookup.
 *
 * MSP is notified per season on CACP's recommendation, and the moisture limit
 * differs by crop and can be relaxed by notification in a bad year. Both are
 * therefore read from `SeasonConfig` at the moment they are used — never
 * hard-coded, and never cached past the request that needs them.
 */

import type { Crop } from "@prisma/client";
import { prisma } from "../db.js";
import { HttpError } from "../http/errors.js";

export interface ActiveSeason {
  id: string;
  season: string;
  crop: Crop;
  mspPaisePerQuintal: bigint;
  moistureLimitPercent: number;
}

/**
 * The active season for a crop in a state.
 *
 * Throws 409 rather than falling back to a default. A J-form priced at a guessed
 * MSP is worse than no J-form: it is a number a farmer will be paid against, and
 * an invented one is very hard to unpick later.
 */
export async function activeSeason(crop: Crop, state: string): Promise<ActiveSeason> {
  const config = await prisma.seasonConfig.findFirst({
    where: { crop, state, active: true },
    orderBy: { startsOn: "desc" },
  });

  if (!config) {
    throw new HttpError(
      409,
      "capacity_moved",
      `No active ${crop.toLowerCase()} season is configured for ${state}. A district admin must set the season and MSP before procurement can start.`,
    );
  }

  return {
    id: config.id,
    season: config.season,
    crop: config.crop,
    mspPaisePerQuintal: config.mspPaisePerQuintal,
    moistureLimitPercent: config.moistureLimitPercent,
  };
}
