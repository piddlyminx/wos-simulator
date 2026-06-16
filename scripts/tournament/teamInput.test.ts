import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSimulatorConfig } from "../../simulator/src/config";
import { simulateBattle } from "../../simulator/src/simulator";
import { applyHeroGenerationStats } from "../../simulator/src/resolve";
import { teamToBattleInput, teamToFighterInput } from "./teamInput";
import type { HeroInputEntry } from "../../simulator/src/types";
import type { Team } from "./types";

const sampleTeam: Team = {
  id: 7,
  mains: ["Wu Ming", "Mia", "Bradley"],
  joiners: ["Jessie", "Norah", "Norah", "Wu Ming"],
  ratioLabel: "50-20-30",
  troops: { infantry_t10: 50, lancer_t10: 20, marksman_t10: 30 }
};

test("teamToFighterInput maps mains and repeated joiners to array hero inputs", () => {
  const fighter = teamToFighterInput(sampleTeam, loadSimulatorConfig());
  assert.deepEqual(fighter.troops, sampleTeam.troops);
  assert.ok(Array.isArray(fighter.heroes));
  assert.ok(Array.isArray(fighter.joiner_heroes));
  const heroes = fighter.heroes as HeroInputEntry[];
  const joiners = fighter.joiner_heroes as HeroInputEntry[];
  assert.equal(heroes.length, 3);
  assert.equal(joiners.length, 4);
  assert.deepEqual(
    joiners.filter((entry) => entry.name === "Norah").map((entry) => entry.levels),
    [{ skill_1: 5 }, { skill_1: 5 }]
  );
});

test("teamToBattleInput sets max rounds, seed, engagement type, and bakes hero generation stats", () => {
  const config = loadSimulatorConfig();
  const input = teamToBattleInput(sampleTeam, sampleTeam, 123, config);
  assert.equal(input.maxRounds, 600);
  assert.equal(input.seed, 123);
  assert.equal(input.engagement_type, "rally");
  // No player stats supplied, so the fighter's stats come entirely from baked hero generation stats.
  assert.deepEqual(input.attacker.stats, applyHeroGenerationStats(teamToFighterInput(sampleTeam, config), config).stats);
});

test("teamToBattleInput applies supplied player stats (plus baked generation stats) to both fighters", () => {
  const config = loadSimulatorConfig();
  const playerStats = {
    infantry: { attack: 1, defense: 2, lethality: 3, health: 4 },
    lancer: { attack: 5, defense: 6, lethality: 7, health: 8 },
    marksman: { attack: 9, defense: 10, lethality: 11, health: 12 }
  };
  const input = teamToBattleInput(sampleTeam, sampleTeam, 123, config, playerStats);
  const expected = applyHeroGenerationStats(teamToFighterInput(sampleTeam, config, playerStats), config).stats;

  assert.deepEqual(input.attacker.stats, expected);
  assert.deepEqual(input.defender.stats, expected);
});

test("teamToBattleInput activates rally attacker and garrison defender widgets", () => {
  const config = loadSimulatorConfig();
  const result = simulateBattle({ ...teamToBattleInput(sampleTeam, sampleTeam, 123, config), maxRounds: 0 }, config);

  assert.equal(result.skillReport.attacker.some((entry) => entry.skillId === "PrecisionDrive"), true);
  assert.equal(result.skillReport.defender.some((entry) => entry.skillId === "SiegeInsight"), true);
  assert.equal(result.skillReport.attacker.some((entry) => entry.skillId === "SiegeInsight"), false);
  assert.equal(result.skillReport.defender.some((entry) => entry.skillId === "PrecisionDrive"), false);
});
