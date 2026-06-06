import assert from "node:assert/strict";
import { test } from "node:test";

import { generateTeams, parseRatio, selectFinalsTeamsByMainLineup } from "./teamGeneration";
import type { Team } from "./types";

test("parseRatio normalizes percentages and assigns marksman remainder", () => {
  assert.deepEqual(parseRatio("50,20,30", 100001), {
    infantry_t10: 50001,
    lancer_t10: 20000,
    marksman_t10: 30000
  });
});

test("parseRatio rejects malformed and zero ratios", () => {
  assert.throws(() => parseRatio("50,50", 100), /ratio must be/);
  assert.throws(() => parseRatio("0,0,0", 100), /sum must be greater than zero/);
});

test("selectFinalsTeamsByMainLineup caps repeated main lineups", () => {
  const teams: Team[] = [1, 2, 3, 4].map((id) => ({
    id,
    mains: id <= 3 ? ["Wu Ming", "Mia", "Bradley"] : ["Hector", "Mia", "Bradley"],
    joiners: ["Jessie", "Seo-yoon", "Lumak", "Ling"],
    ratioLabel: "50-20-30",
    troops: { infantry_t10: 50, lancer_t10: 20, marksman_t10: 30 }
  }));

  assert.deepEqual(selectFinalsTeamsByMainLineup(teams, 3, 2).map((team) => team.id), [1, 2, 4]);
  assert.deepEqual(selectFinalsTeamsByMainLineup(teams, 3, 0).map((team) => team.id), [1, 2, 3]);
});
