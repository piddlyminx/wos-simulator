import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSimulatorConfig } from "../simulator/src/config-node";
import type { BattleResult, FighterInput, UnitType } from "../simulator/src/types";
import {
  evaluateDefinition,
  applyTroopComposition,
  generateAdaptiveTroopCompositions,
  generateBoundaryTroopCompositions,
  generateLocalTroopCompositions,
  generateTroopCompositions,
  createHeroOptimizationWorkerContext,
  effectiveDefinitionForOptimizationCandidate,
  generateOptimizationCandidateKeys,
  heroNamesForOptimizationCandidate,
  optimizeDefinition,
  optimizeDefinitionParallel,
  optimizeWinningTroopsParallel,
  parseCliArgs,
  parseDefinition,
  simulateThreeArmyMatch,
  substitutedHeroStats,
  troopOptimizationArmyLabels,
  type ThreeArmyDefinition
} from "./three_army_optimizer";

const simulatorConfig = loadSimulatorConfig();

test("three-army definitions default to the standard 1500-round cap", () => {
  const raw = definitionWithInfantry([10, 10, 10], [5, 5, 5]);
  delete raw.max_rounds;

  assert.equal(parseDefinition(raw, simulatorConfig).max_rounds, 1500);
  assert.equal(parseDefinition(raw, simulatorConfig).ordering, "sequential");
});

test("three-army definitions accept only sequential or random ordering", () => {
  const raw = definitionWithInfantry([10, 10, 10], [5, 5, 5]);
  raw.ordering = "random";
  assert.equal(parseDefinition(raw, simulatorConfig).ordering, "random");

  assert.throws(
    () => parseDefinition({ ...raw, ordering: "alternating" }, simulatorConfig),
    /ordering must be sequential or random/
  );
});

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

test("random ordering selects any living pair before every battle", () => {
  const definition = definitionWithInfantry([10, 20, 30], [1, 2, 3]);
  definition.ordering = "random";
  const fights: string[] = [];
  const resolver = (attacker: FighterInput, defender: FighterInput): BattleResult => {
    fights.push(`${attacker.name} vs ${defender.name}`);
    return battleResult("attacker", attacker.troops.infantry_t6, 0);
  };

  const result = simulateThreeArmyMatch(
    definition,
    simulatorConfig,
    [0, 1, 2],
    [0, 1, 2],
    "test",
    resolver
  );

  assert.deepEqual(fights, [
    "attacker-3 vs defender-2",
    "attacker-2 vs defender-3",
    "attacker-2 vs defender-1"
  ]);
  assert.deepEqual(result, { winner: "attacker", attackerRemaining: 60, defenderRemaining: 0, battles: 3 });
});

test("sequential evaluation covers every pair of army orderings for every rep", () => {
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
  assert.equal(result.attackerMarginStd, 0);
});

test("random evaluation runs exactly the requested number of trajectories", () => {
  const definition = definitionWithInfantry([10, 10, 10], [5, 5, 5]);
  definition.ordering = "random";
  const result = evaluateDefinition(
    definition,
    simulatorConfig,
    7,
    42,
    (attacker) => battleResult("attacker", attacker.troops.infantry_t6, 0)
  );

  assert.equal(result.scenarios, 7);
  assert.equal(result.attackerWins, 7);
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

  const context = createHeroOptimizationWorkerContext(definition, simulatorConfig);
  const candidates = [...generateOptimizationCandidateKeys(context)];
  const firstDefinition = effectiveDefinitionForOptimizationCandidate(context, candidates[0]);
  const firstHeroes = heroNamesForOptimizationCandidate(context, candidates[0]);

  assert.equal(candidates.length, 216);
  assert.equal(new Set(firstHeroes.flat()).size, 9);
  assert.deepEqual(
    (firstDefinition.attacker[0].fighter.heroes as Array<{ name: string }>).map((hero) => hero.name),
    firstHeroes[0]
  );
  const firstHero = (firstDefinition.attacker[0].fighter.heroes as Array<{ levels: Record<string, number> }>)[0];
  assert.deepEqual(Object.keys(firstHero.levels), ["skill_1", "skill_2", "skill_3"]);
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

  const context = createHeroOptimizationWorkerContext(definition, simulatorConfig);
  const candidate = [...generateOptimizationCandidateKeys(context)][0];
  const candidateDefinition = effectiveDefinitionForOptimizationCandidate(context, candidate);
  const candidateEffective = candidateDefinition.attacker[0].fighter;
  const fixedEffective = candidateDefinition.defender[0].fighter;

  assert.deepEqual(
    heroNamesForOptimizationCandidate(context, candidate)[0],
    ["Edith", "Philly", "Hendrik"]
  );
  assert.equal(candidateEffective.stats?.infantry?.attack, 750.52);
  assert.equal(candidateEffective.stats?.lancer?.attack, 340.19);
  assert.equal(candidateEffective.stats?.marksman?.attack, 880.62);
  assert.deepEqual(fixedEffective.stats, reportResolvedStatsForGatotSonyaBradley());
  assert.deepEqual(
    substitutedHeroStats(
      definition,
      heroNamesForOptimizationCandidate(context, candidate),
      simulatorConfig
    )[0],
    candidateEffective.stats
  );
});

test("hero stat rows retain their march and troop-type baselines", () => {
  const raw = definitionWithInfantry([10, 10, 10], [5, 5, 5]);
  raw.input_stats_include_hero_generation = { attacker: true, defender: true };
  for (const [armyIndex, army] of [...raw.attacker, ...raw.defender].entries()) {
    army.fighter.heroes = {
      Gatot: { skill_1: 5 },
      Sonya: { skill_1: 5 },
      Bradley: { skill_1: 5 }
    };
    const offset = (armyIndex % 3) * 100;
    const stats = reportResolvedStatsForGatotSonyaBradley();
    for (const row of Object.values(stats)) {
      row.attack += offset;
      row.defense += offset;
      row.lethality += offset;
      row.health += offset;
    }
    army.fighter.stats = stats;
  }
  const definition = parseDefinition({
    ...raw,
    optimization: {
      side: "attacker",
      hero_skill_levels: [5, 5, 5, 0],
      unique_heroes: false,
      hero_pools: {
        infantry: ["Logan"],
        lancer: ["Sonya"],
        marksman: ["Bradley"]
      }
    }
  }, simulatorConfig);

  const context = createHeroOptimizationWorkerContext(definition, simulatorConfig);
  const candidate = generateOptimizationCandidateKeys(context).next().value;
  assert.ok(candidate);
  const candidateDefinition = effectiveDefinitionForOptimizationCandidate(context, candidate);

  assert.equal(candidateDefinition.attacker[0].fighter.stats?.infantry.attack, 390.23);
  assert.equal(candidateDefinition.attacker[1].fighter.stats?.infantry.attack, 490.23);
  assert.ok(Math.abs((candidateDefinition.attacker[2].fighter.stats?.infantry.attack ?? 0) - 590.23) < 1e-9);
  assert.equal(candidateDefinition.attacker[1].fighter.stats?.lancer.attack, 980.62);
  assert.equal(candidateDefinition.attacker[1].fighter.stats?.marksman.attack, 850.52);
});

test("parallel hero optimization matches serial ranking while retaining only requested results", async () => {
  const raw = definitionWithInfantry([2, 2, 2], [1, 1, 1]);
  raw.max_rounds = 1;
  raw.ordering = "random";
  const definition = parseDefinition({
    ...raw,
    optimization: {
      side: "attacker",
      hero_skill_levels: [1, 1, 1, 0],
      unique_heroes: false,
      per_army_hero_pools: [
        { infantry: ["Gatot", "Logan"], lancer: ["Sonya"], marksman: ["Bradley"] },
        { infantry: ["Gatot"], lancer: ["Sonya"], marksman: ["Bradley"] },
        { infantry: ["Gatot"], lancer: ["Sonya"], marksman: ["Bradley"] }
      ]
    }
  }, simulatorConfig);
  let completed = 0;
  let battlesCompleted = 0;
  const progressSamples: Array<[number, number, number]> = [];

  const serial = optimizeDefinition(definition, simulatorConfig, 1, 42, 10, undefined, 1);
  const parallel = await optimizeDefinitionParallel(
    definition,
    simulatorConfig,
    1,
    42,
    2,
    10,
    (value, _total, battles) => {
      completed = value;
      battlesCompleted = battles;
      progressSamples.push([value, _total, battles]);
    },
    1,
    {
      retainFractions: [1, 1, 1, 1],
      minimumRetained: 1,
      minimumCandidates: 1
    }
  );

  assert.equal(completed, 2);
  assert.ok(battlesCompleted > 0);
  assert.deepEqual(progressSamples[0], [0, 2, 0]);
  assert.equal(serial.length, 1);
  assert.deepEqual(parallel, serial);
  assert.equal(parallel[0].evaluation.scenarios, 1);
});

test("large hero searches use balanced screening stages before a fresh final evaluation", async () => {
  const raw = definitionWithInfantry([2, 2, 2], [1, 1, 1]);
  raw.max_rounds = 1;
  const definition = parseDefinition({
    ...raw,
    optimization: {
      side: "attacker",
      hero_skill_levels: [1, 1, 1, 0],
      unique_heroes: false,
      per_army_hero_pools: [
        {
          infantry: ["Gatot", "Edith", "Hector", "Wu Ming", "Logan"],
          lancer: ["Mia", "Philly", "Gordon"],
          marksman: ["Bradley", "Hendrik", "Wayne"]
        },
        {
          infantry: ["Gatot", "Edith", "Logan"],
          lancer: ["Sonya"],
          marksman: ["Greg"]
        },
        {
          infantry: ["Hector"],
          lancer: ["Philly"],
          marksman: ["Alonso"]
        }
      ]
    }
  }, simulatorConfig);
  const stageStarts: Array<{ stage: string; total: number }> = [];

  const results = await optimizeDefinitionParallel(
    definition,
    simulatorConfig,
    1,
    42,
    2,
    200,
    (completed, total, _battles, stage = "final") => {
      if (completed === 0) stageStarts.push({ stage, total });
    },
    1
  );

  assert.deepEqual(stageStarts.map(({ stage }) => stage), [
    "screen-12",
    "screen-36",
    "screen-72",
    "screen-144",
    "final"
  ]);
  assert.equal(stageStarts[0].total, 135);
  assert.equal(stageStarts.at(-1)!.total, 100);
  assert.equal(results.length, 1);
  assert.equal(results[0].evaluation.scenarios, 36);
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

test("included hero-generation stats treat missing heroes as zero generation", () => {
  const raw = definitionWithInfantry([10, 10, 10], [5, 5, 5]);
  const expectedStats = reportResolvedStatsForGatotSonyaBradley();
  raw.input_stats_include_hero_generation.attacker = true;
  for (const army of raw.attacker) army.fighter.stats = structuredClone(expectedStats);
  const definition = parseDefinition(raw, simulatorConfig);
  let normalizedStats: FighterInput["stats"];

  simulateThreeArmyMatch(
    definition,
    simulatorConfig,
    [0, 1, 2],
    [0, 1, 2],
    "missing-heroes",
    (attacker) => {
      normalizedStats ??= attacker.stats;
      return battleResult("attacker", attacker.troops.infantry_t6, 0);
    }
  );

  assert.deepEqual(normalizedStats, expectedStats);
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

test("adaptive troop grids explicitly cover zero and singleton troop boundaries", () => {
  const center = { infantry: 97_564, lancer: 1, marksman: 119_245, total: 216_810 };
  const boundaries = generateBoundaryTroopCompositions(center);
  const lancerZero = boundaries.find((composition) => composition.lancer === 0);

  assert.ok(lancerZero);
  assert.equal(lancerZero.total, center.total);
  assert.equal(lancerZero.infantry + lancerZero.lancer + lancerZero.marksman, center.total);
  assert.ok(boundaries.some((composition) => composition.lancer === 1));

  const coarse = generateAdaptiveTroopCompositions(1_000, 10);
  assert.ok(coarse.some((composition) =>
    composition.lancer === 1 && Math.abs(composition.infantry - composition.marksman) <= 1
  ));
  assert.ok(coarse.some((composition) =>
    composition.lancer === 0 && composition.infantry === 500 && composition.marksman === 500
  ));
});

test("adaptive local search expands multiple seeds and retains boundary neighbours", () => {
  const compositions = generateLocalTroopCompositions([
    { infantry: 50, lancer: 0, marksman: 50, total: 100 },
    { infantry: 30, lancer: 40, marksman: 30, total: 100 }
  ], 1, 1);

  assert.ok(compositions.some((composition) => composition.infantry === 50 && composition.lancer === 1));
  assert.ok(compositions.some((composition) =>
    composition.infantry === 31 && composition.lancer === 40 && composition.marksman === 29
  ));
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

test("troop optimization parses configurable adaptive search", () => {
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
    side: "attacker",
    coarse_step_percent: 20,
    fine_step_percent: 2,
    fine_radius_percent: 6,
    passes: 3
  });
});

test("troop optimization defaults match the dashboard adaptive search resolution", () => {
  const definition = parseDefinition({
    ...definitionWithInfantry([10, 10, 10], [5, 5, 5]),
    troop_optimization: { side: "attacker" }
  }, simulatorConfig);

  assert.deepEqual(definition.troop_optimization, {
    side: "attacker",
    coarse_step_percent: 5,
    fine_step_percent: 1,
    fine_radius_percent: 3,
    passes: 2
  });
});

test("troop optimization without hero optimization uses the input lineup", async () => {
  const raw = {
    ...definitionWithInfantry([10, 10, 10], [5, 5, 5]),
    troop_optimization: {
      side: "attacker",
      coarse_step_percent: 100,
      fine_step_percent: 100,
      fine_radius_percent: 100,
      passes: 1
    }
  };
  const definition = parseDefinition(raw, simulatorConfig);
  const expectedBaseline = evaluateDefinition(definition, simulatorConfig, 1, 42);
  const stages = new Set<string>();

  const result = await optimizeWinningTroopsParallel(
    definition,
    [],
    simulatorConfig,
    1,
    42,
    1,
    ({ stage }) => stages.add(stage)
  );

  assert.equal(result.side, "attacker");
  assert.deepEqual(result.heroes, [[], [], []]);
  assert.deepEqual(result.initialEvaluation, expectedBaseline);
  assert.deepEqual(result.initialTroops, [
    { infantry: 10, lancer: 0, marksman: 0, total: 10 },
    { infantry: 10, lancer: 0, marksman: 0, total: 10 },
    { infantry: 10, lancer: 0, marksman: 0, total: 10 }
  ]);
  assert.deepEqual([...stages], ["coarse", "fine", "finalist"]);
  assert.equal(result.preliminaryRepsPerOrdering, 1);
  assert.equal(result.finalistRepsPerOrdering, 1);
});

test("troop optimization requires its own side when hero optimization is omitted", () => {
  const raw = {
    ...definitionWithInfantry([10, 10, 10], [5, 5, 5]),
    troop_optimization: {}
  };

  assert.throws(
    () => parseDefinition(raw, simulatorConfig),
    /troop_optimization\.side is required when optimization is omitted/
  );
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

test("troop optimization labels use the selected heroes instead of stale input names", () => {
  const definition = definitionWithInfantry([10, 10, 10], [5, 5, 5]);
  definition.attacker[0].name = "Attacker 1: Gatot, Sonya, Bradley";
  definition.attacker[0].fighter.heroes = {
    Gatot: { skill_1: 5 },
    Sonya: { skill_1: 5 },
    Bradley: { skill_1: 5 }
  };
  definition.attacker[1].name = "Second wave";
  definition.attacker[2].name = "Attacker 3: Wu Ming, Philly, Wayne";
  definition.attacker[2].fighter.heroes = {
    "Wu Ming": { skill_1: 5 },
    Philly: { skill_1: 5 },
    Wayne: { skill_1: 5 }
  };

  assert.deepEqual(
    troopOptimizationArmyLabels(
      {
        side: "attacker",
        heroes: [
          ["Gatot", "Sonya", "Greg"],
          ["Wu Ming", "Philly", "Hendrik"],
          ["Edith", "Mia", "Bradley"]
        ]
      },
      definition
    ),
    [
      "Attacker 1: Gatot, Sonya, Greg",
      "Second wave: Wu Ming, Philly, Hendrik",
      "Attacker 3: Edith, Mia, Bradley"
    ]
  );
});

function definitionWithInfantry(attackerCounts: number[], defenderCounts: number[]): ThreeArmyDefinition {
  return {
    attacker: armies("attacker", attackerCounts),
    defender: armies("defender", defenderCounts),
    ordering: "sequential",
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
