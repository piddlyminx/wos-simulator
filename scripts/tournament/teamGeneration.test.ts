import assert from "node:assert/strict";
import { test } from "node:test";

import { generateTeams, JOINER_POOL, parseRatio, selectFinalsTeamsByMainLineup, teamBuildKey, uniqueRankedTeams } from "./teamGeneration";
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

test("joiner inventory multiplicities allow repeated heroes without duplicating builds", () => {
  const ratio: [string, Team["troops"]] = ["50-20-30", parseRatio("50,20,30", 100)];
  const teams = generateTeams([ratio, ratio]);
  assert.equal(new Set(teams.map(teamBuildKey)).size, teams.length);
  const inventory = new Map<string, number>();
  for (const name of JOINER_POOL) inventory.set(name, (inventory.get(name) ?? 0) + 1);
  const firstMains = teams[0].mains.join("|");
  const variants = teams.filter(team => team.mains.join("|") === firstMains);
  for (const [name, capacity] of inventory) {
    const counts = variants.map(team => team.joiners.filter(joiner => joiner === name).length);
    assert.equal(Math.max(...counts), Math.min(capacity, 4));
    assert(counts.every(count => count <= capacity));
  }
});

test("replacement joiners permit four copies but never duplicate builds", () => {
  const teams = generateTeams([["50-20-30", parseRatio("50,20,30", 100)]], true);
  assert.equal(new Set(teams.map(teamBuildKey)).size, teams.length);
  const firstMains = teams[0].mains.join("|");
  const variants = teams.filter(team => team.mains.join("|") === firstMains);
  for (const name of new Set(JOINER_POOL)) {
    assert(variants.some(team => team.joiners.every(joiner => joiner === name)));
  }
});

test("ranked build identity ignores joiner order, not multiplicity or troop allocation", () => {
  const original: Team = {
    id: 1, mains: ["Magnus", "Molly", "Xura"],
    joiners: ["Hendrik", "Patrick", "Mia", "Norah"], ratioLabel: "40-1-59",
    troops: { infantry_t10: 40, lancer_t10: 1, marksman_t10: 59 }
  };
  const reordered: Team = { ...original, id: 2, joiners: ["Norah", "Mia", "Patrick", "Hendrik"] };
  const repeated: Team = { ...original, id: 3, joiners: ["Patrick", "Mia", "Norah", "Norah"] };
  const differentCounts: Team = { ...original, id: 4, troops: { infantry_t10: 80, lancer_t10: 2, marksman_t10: 118 } };
  const differentRatio: Team = { ...original, id: 5, ratioLabel: "49-2-49" };
  assert.deepEqual(uniqueRankedTeams([original, reordered, repeated, differentCounts, differentRatio]).map(team => team.id), [1, 3, 4, 5]);
  assert.deepEqual(original.joiners, ["Hendrik", "Patrick", "Mia", "Norah"]);
});
