import assert from "node:assert/strict";
import { test } from "node:test";

import {
  estimateTournamentTeamCount,
  JOINER_POOL,
  mainHeroesForRole,
  parseTournamentRatioList,
} from "@/lib/tournament";

test("parseTournamentRatioList accepts comma and hyphen ratios separated by spaces or semicolons", () => {
  assert.deepEqual(
    parseTournamentRatioList("50,20,30; 40-30-30\n60, 10, 30"),
    {
      ratios: ["50,20,30", "40,30,30", "60,10,30"],
      error: null,
    },
  );
});

test("parseTournamentRatioList reports partially invalid input instead of dropping it", () => {
  assert.deepEqual(
    parseTournamentRatioList("50,20,30; 40/30/30; 60-10-30"),
    {
      ratios: ["50,20,30", "60,10,30"],
      error: "Some ratio input was not recognised. Use inf,lanc,mark or inf-lanc-mark, separated by semicolons or spaces.",
    },
  );
});

test("parseTournamentRatioList reports empty and wholly invalid input", () => {
  assert.equal(parseTournamentRatioList("").error, "Enter at least one ratio.");
  assert.equal(
    parseTournamentRatioList("50/20/30").error,
    "No valid ratios found. Use inf,lanc,mark or inf-lanc-mark.",
  );
});

test("estimateTournamentTeamCount accounts for mains excluded from the joiner pool", () => {
  const joiners = JOINER_POOL.filter((hero) => hero !== "Ahmose" && hero !== "Wayne");
  assert.equal(
    estimateTournamentTeamCount([{
      label: "All",
      infantryMains: mainHeroesForRole("inf"),
      lancerMains: mainHeroesForRole("lanc"),
      marksmanMains: mainHeroesForRole("mark"),
      joiners,
      ratios: ["50,20,30", "40,30,30", "60,20,20", "55,25,20", "45,25,30"],
      allowRepeatedJoiners: false,
      excludeMainHeroesFromJoiners: true,
    }]),
    240_200,
  );
});
