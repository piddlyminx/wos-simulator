import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeTeamHeuristics } from "./heuristics";
import type { Score, Team } from "./types";

function score(id: number, joiners: Team["joiners"], rate: number, games = 100, ratio = "40-1-59"): Score {
  return {
    team: { id, mains: ["Magnus", "Molly", "Xura"], joiners, ratioLabel: ratio, troops: { infantry_t10: 40, lancer_t10: 1, marksman_t10: 59 } },
    winRateSum: rate, matches: 1, games, margin: rate * 100,
    attack: { winRateSum: 0, matches: 0, margin: 0 }, defense: { winRateSum: 0, matches: 0, margin: 0 }
  };
}

test("core and flexible joiners describe the strong band, not weak shortlisted variants", () => {
  const report = analyzeTeamHeuristics([
    score(1, ["Mia", "Patrick", "Hendrik", "Norah"], .95),
    score(2, ["Mia", "Patrick", "Hendrik", "Philly"], .94),
    score(3, ["Mia", "Patrick", "Norah", "Philly"], .93),
    score(4, ["Mia", "Patrick", "Lumak", "Hendrik"], .92),
    score(5, ["Jessie", "Patrick", "Lumak", "Ling"], .80)
  ]);
  const recipe = report.families[0].formations[0];
  assert.deepEqual(recipe.strong.map(build => build.team.id), [1, 2, 3, 4]);
  assert.deepEqual(recipe.core.map(choice => [choice.name, choice.count]), [["Mia", 4], ["Patrick", 4]]);
  assert.deepEqual(recipe.flexible.map(choice => [choice.name, choice.count]), [["Hendrik", 3], ["Norah", 2], ["Philly", 2]]);
  assert.equal(recipe.flexible[0].minWinRate, .92);
  assert.equal(recipe.flexible[0].maxWinRate, .95);
  assert.equal(recipe.builds.length, 5);
});

test("duplicates are game-weighted once before ranking and hero frequency calculation", () => {
  const first = score(1, ["Mia", "Patrick", "Hendrik", "Norah"], .9, 100);
  const second = score(2, ["Norah", "Hendrik", "Patrick", "Mia"], .5, 300);
  const report = analyzeTeamHeuristics([first, second, score(3, ["Jessie", "Patrick", "Hendrik", "Norah"], .7)]);
  assert.equal(report.duplicateRows, 1);
  assert.equal(report.builds.length, 2);
  assert.deepEqual(report.builds.map(build => build.team.id), [3, 1]);
  assert.equal(report.builds[1].winRate, .6);
  assert.equal(report.builds[1].games, 400);
  assert.equal(report.builds[1].margin, 60);
  assert.equal(report.heroes.find(hero => hero.name === "Mia")?.count, 1);
  assert.equal(report.families[0].formations[0].core.length, 0);
});

test("hero presence counts each build once across main and repeated joiner roles", () => {
  const report = analyzeTeamHeuristics([
    score(1, ["Molly", "Molly", "Patrick", "Mia"], .9),
    score(2, ["Molly", "Molly", "Hendrik", "Mia"], .89),
    score(3, ["Molly", "Molly", "Norah", "Mia"], .88),
    score(4, ["Molly", "Patrick", "Norah", "Mia"], .87, 100, "49-2-49")
  ]);
  assert.deepEqual(report.heroes.find(hero => hero.name === "Molly"), { name: "Molly", count: 4, mains: 4, joiners: 4 });
  assert.equal(report.families[0].formations.length, 2);
  const first = report.families[0].formations[0];
  assert.equal(first.core.find(choice => choice.name === "Molly" && choice.copies === 2)?.count, 3);
  assert.equal(report.families[0].formations[1].core.length, 0);
});

test("hero dominance is measured among top distinct builds and formation ranges stay separate", () => {
  const candidates = Array.from({length: 101}, (_, i) => score(i, [`Choice-${i}`, "Mia", "Patrick", "Norah"], .9 - i / 1000));
  candidates[100].team.mains = ["Gatot", "Sonya", "Bradley"];
  const report = analyzeTeamHeuristics(candidates);
  assert.equal(report.leaders.length, 100);
  assert.equal(report.heroes.find(hero => hero.name === "Magnus")?.count, 100);
  assert.equal(report.heroes.find(hero => hero.name === "Gatot"), undefined);
  assert.equal(report.families.length, 2);
  assert.deepEqual(report.families[1].mains, ["Gatot", "Sonya", "Bradley"]);
  assert.equal(report.families[1].builds[0].winRate, .8);
});
