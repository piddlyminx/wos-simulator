import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSimulatorConfig } from "../simulator/src/config-node";
import { applyHeroGenerationStats } from "../simulator/src/fighterResolution";
import type { BattleResult, FighterInput, UnitType } from "../simulator/src/types";
import {
  evaluateDefinition,
  applyTroopComposition,
  generateTroopCompositions,
  generateOptimizationCandidates,
  parseCliArgs,
  parseDefinition,
  simulateThreeArmyMatch,
  type ThreeArmyDefinition
} from "./three_army_optimizer";

const simulatorConfig = loadSimulatorConfig();

test("three-army match runs opening slots then the lowest-numbered survivors", () => {
  const definition = definitionWithInfantry([10, 25, 30], [15, 15, 25]);
  const fights: string[] = [];
  const resolver = (attacker: FighterInput, defender: FighterInput): BattleResult => {
    fights.push(`${attacker.name}:${attacker.troops.infantry_t6} vs ${defender.name}:${defender.troops.infantry_t6}`);
    const attackerCount = attacker.troops.infantry_t6;
    const defenderCount = defender.troops.infantry_t6;
    const winner = attackerCount > defenderCount ? "attacker" : attackerCount < defenderCount ? "defender" : "draw";
    return battleResult(winner, Math.max(0, attackerCount - defenderCount), Math.max(0, defenderCount - attackerCount));
  };

  const result = simulateThreeArmyMatch(definition, simulatorConfig, [0, 1, 2], [0, 1, 2], "test", resolver);

  assert.deepEqual(fights, [
    "attacker-1:10 vs defender-1:15",
    "attacker-2:25 vs defender-2:15",
    "attacker-3:30 vs defender-3:25",
    "attacker-2:10 vs defender-1:5"
  ]);
  assert.deepEqual(result, { winner: "attacker", attackerRemaining: 10, defenderRemaining: 0, battles: 4 });
});

test("evaluation covers every pair of random orderings for every rep", () => {
  const definition = definitionWithInfantry([10, 10, 10], [5, 5, 5]);
  const result = evaluateDefinition(
    definition,
    simulatorConfig,
    2,
    42,
    (attacker, defender) => battleResult("attacker", attacker.troops.infantry_t6 - defender.troops.infantry_t6, 0)
  );

  assert.equal(result.scenarios, 72);
  assert.equal(result.attackerWins, 72);
  assert.equal(result.attackerWinRate, 1);
  assert.equal(result.averageBattles, 3);
});

test("optimization candidates assign each role once per army without reusing heroes", () => {
  const raw = {
    ...definitionWithInfantry([10, 10, 10], [5, 5, 5]),
    optimization: {
      side: "attacker",
      hero_skill_levels: [5, 5, 5, 0],
      unique_heroes: true,
      hero_pools: {
        infantry: ["Gatot", "Edith", "Wu Ming"],
        lancer: ["Sonya", "Philly", "Mia"],
        marksman: ["Bradley", "Hendrik", "Wayne"]
      }
    }
  };
  const definition = parseDefinition(raw, simulatorConfig);

  const candidates = generateOptimizationCandidates(definition, simulatorConfig);

  assert.equal(candidates.length, 216);
  assert.equal(new Set(candidates[0].heroes.flat()).size, 9);
  assert.deepEqual(
    (candidates[0].definition.attacker[0].fighter.heroes as Array<{ name: string }>).map((hero) => hero.name),
    candidates[0].heroes[0]
  );
  const firstHero = (candidates[0].definition.attacker[0].fighter.heroes as Array<{ levels: Record<string, number> }>)[0];
  assert.equal(firstHero.levels.skill_1, 5);
  assert.equal(firstHero.levels.skill_3, 5);
  assert.equal(firstHero.levels.skill_4, undefined);
});

test("optimization rebases report-resolved stats before applying each candidate's heroes", () => {
  const raw = definitionWithInfantry([10, 10, 10], [5, 5, 5]);
  raw.input_stats_include_hero_generation = { attacker: true, defender: true };
  for (const army of [...raw.attacker, ...raw.defender]) {
    army.fighter.heroes = {
      Gatot: { skill_1: 5 },
      Sonya: { skill_1: 5 },
      Bradley: { skill_1: 5 }
    };
    army.fighter.stats = reportResolvedStatsForGatotSonyaBradley();
  }
  const definition = parseDefinition({
    ...raw,
    optimization: {
      side: "attacker",
      hero_skill_levels: [5, 5, 5, 0],
      unique_heroes: true,
      hero_pools: {
        infantry: ["Edith", "Gatot", "Wu Ming"],
        lancer: ["Philly", "Sonya", "Mia"],
        marksman: ["Hendrik", "Bradley", "Wayne"]
      }
    }
  }, simulatorConfig);

  const candidate = generateOptimizationCandidates(definition, simulatorConfig)[0];
  const candidateEffective = applyHeroGenerationStats(candidate.definition.attacker[0].fighter, simulatorConfig);
  const fixedEffective = applyHeroGenerationStats(candidate.definition.defender[0].fighter, simulatorConfig);

  assert.deepEqual(candidate.heroes[0], ["Edith", "Philly", "Hendrik"]);
  assert.equal(candidateEffective.stats?.infantry?.attack, 750.52);
  assert.equal(candidateEffective.stats?.lancer?.attack, 340.19);
  assert.equal(candidateEffective.stats?.marksman?.attack, 880.62);
  assert.deepEqual(fixedEffective.stats, reportResolvedStatsForGatotSonyaBradley());
});

test("configuration rejects an optimization hero in the wrong troop role", () => {
  const raw = {
    ...definitionWithInfantry([10, 10, 10], [5, 5, 5]),
    optimization: {
      side: "attacker",
      hero_skill_levels: [5, 5, 5, 0],
      hero_pools: {
        infantry: ["Sonya"],
        lancer: ["Philly"],
        marksman: ["Bradley"]
      }
    }
  };

  assert.throws(() => parseDefinition(raw, simulatorConfig), /Sonya.*not infantry/);
});

test("configuration rejects rally engagement and joiner heroes", () => {
  const base = definitionWithInfantry([10, 10, 10], [5, 5, 5]);
  assert.throws(
    () => parseDefinition({ ...base, engagement_type: "rally" }, simulatorConfig),
    /not a rally or garrison/
  );

  const withJoiner = structuredClone(base);
  (withJoiner.attacker[0].fighter as FighterInput).joiner_heroes = { Jessie: { skill_1: 5 } };
  assert.throws(() => parseDefinition(withJoiner, simulatorConfig), /joiner_heroes is not supported/);
});

test("included hero-generation stats require the original heroes needed for rebasing", () => {
  const raw = definitionWithInfantry([10, 10, 10], [5, 5, 5]);
  raw.input_stats_include_hero_generation.attacker = true;
  raw.attacker[0].fighter.stats = reportResolvedStatsForGatotSonyaBradley();

  assert.throws(() => parseDefinition(raw, simulatorConfig), /three original main heroes/);
});

test("troop composition grid preserves the army total", () => {
  const compositions = generateTroopCompositions(10, 50);

  assert.equal(compositions.length, 6);
  assert.deepEqual(compositions.map(({ infantry, lancer, marksman }) => [infantry, lancer, marksman]), [
    [0, 0, 10],
    [0, 5, 5],
    [0, 10, 0],
    [5, 0, 5],
    [5, 5, 0],
    [10, 0, 0]
  ]);
  assert.ok(compositions.every((composition) => composition.total === 10));
});

test("applying a troop composition changes one army and leaves the opposing team static", () => {
  const definition = definitionWithInfantry([10, 20, 30], [40, 50, 60]);
  const originalDefender = structuredClone(definition.defender);
  const changed = applyTroopComposition(
    definition,
    "attacker",
    1,
    { infantry: 5, lancer: 10, marksman: 5, total: 20 },
    simulatorConfig
  );

  assert.deepEqual(changed.attacker[1].fighter.troops, {
    infantry_t6: 5,
    lancer_t6: 10,
    marksman_t6: 5
  });
  assert.deepEqual(changed.attacker[0], definition.attacker[0]);
  assert.deepEqual(changed.defender, originalDefender);
  assert.throws(
    () => applyTroopComposition(
      definition,
      "attacker",
      1,
      { infantry: 5, lancer: 10, marksman: 6, total: 21 },
      simulatorConfig
    ),
    /preserve attacker\[1\] total of 20/
  );
});

test("troop optimization parses configurable coarse-to-fine coordinate search", () => {
  const raw = {
    ...definitionWithInfantry([10, 10, 10], [5, 5, 5]),
    optimization: {
      side: "attacker",
      hero_skill_levels: [5, 5, 5, 0],
      hero_pools: {
        infantry: ["Gatot"],
        lancer: ["Sonya"],
        marksman: ["Bradley"]
      },
      unique_heroes: false
    },
    troop_optimization: {
      coarse_step_percent: 20,
      fine_step_percent: 2,
      fine_radius_percent: 6,
      passes: 3
    }
  };

  const definition = parseDefinition(raw, simulatorConfig);

  assert.deepEqual(definition.troop_optimization, {
    coarse_step_percent: 20,
    fine_step_percent: 2,
    fine_radius_percent: 6,
    passes: 3
  });
});

test("CLI parser supplies stable defaults and parses optimization controls", () => {
  const options = parseCliArgs([
    "optimize", "armies.json", "--reps", "3", "--jobs", "2", "--top", "7", "--max-candidates", "500", "--json"
  ]);

  assert.deepEqual(options, {
    command: "optimize",
    configPath: "armies.json",
    reps: 3,
    seed: 1234,
    top: 7,
    maxCandidates: 500,
    jobs: 2,
    json: true
  });
});

function definitionWithInfantry(attackerCounts: number[], defenderCounts: number[]): ThreeArmyDefinition {
  return {
    attacker: armies("attacker", attackerCounts),
    defender: armies("defender", defenderCounts),
    max_rounds: 600,
    input_stats_include_hero_generation: { attacker: false, defender: false }
  };
}

function armies(prefix: string, counts: number[]): ThreeArmyDefinition["attacker"] {
  return counts.map((count, index) => ({
    name: `${prefix} ${index + 1}`,
    fighter: {
      name: `${prefix}-${index + 1}`,
      troops: { infantry_t6: count, lancer_t6: 0, marksman_t6: 0 }
    }
  })) as unknown as ThreeArmyDefinition["attacker"];
}

function battleResult(winner: "attacker" | "defender" | "draw", attacker: number, defender: number): BattleResult {
  const remaining = (infantry: number): Record<UnitType, number> => ({ infantry, lancer: 0, marksman: 0 });
  return {
    winner,
    rounds: 1,
    remaining: { attacker: remaining(attacker), defender: remaining(defender) },
    attacks: [],
    skillReport: { attacker: [], defender: [] },
    resolved: {
      attacker: { troops: remaining(attacker), heroes: [], troopSkillIds: [], diagnostics: [] },
      defender: { troops: remaining(defender), heroes: [], troopSkillIds: [], diagnostics: [] }
    },
    effectActivationCounts: { attacker: 0, defender: 0 },
    extraSkillAttackJobsByEffect: {},
    attackControlCounts: { dodge: 0, no_attack: 0 },
    randomness: { deterministic: true, chanceSkillIds: { attacker: [], defender: [] } }
  };
}

function reportResolvedStatsForGatotSonyaBradley() {
  return {
    infantry: { attack: 880.62, defense: 880.62, lethality: 293, health: 293 },
    lancer: { attack: 880.62, defense: 880.62, lethality: 293, health: 293 },
    marksman: { attack: 750.52, defense: 750.52, lethality: 260.5, health: 260.5 }
  };
}
