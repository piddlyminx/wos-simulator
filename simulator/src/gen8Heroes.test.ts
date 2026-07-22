import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSimulatorConfig } from "./config";
import { resolveFighter } from "./fighterResolution";
import { simulateBattles } from "./simulator";
import type { BattleInput } from "./types";

test("Gen8 heroes are registered with the shared S8 expedition stats", () => {
  const config = loadSimulatorConfig();

  assert.deepEqual(config.heroGenerationStats.S8, {
    attack: 780.62,
    defense: 780.62,
    lethality: 193,
    health: 193
  });
  assert.deepEqual(
    ["Gatot", "Sonya", "Hendrik"].map((name) => [name, config.heroDefinitions[name]?.hero_generation]),
    [
      ["Gatot", "S8"],
      ["Sonya", "S8"],
      ["Hendrik", "S8"]
    ]
  );
});

test("Gen8 widget skills are fourth, passive, and engagement-gated", () => {
  const config = loadSimulatorConfig();
  const expectations = [
    ["Gatot", "IndestructibleCity", "garrison", "passive.defense.up"],
    ["Sonya", "VortexTurret", "garrison", "passive.lethality.up"],
    ["Hendrik", "AbyssalBlessing", "rally", "passive.attack.up"]
  ] as const;

  for (const [heroName, skillName, engagement, effectType] of expectations) {
    const definition = config.heroDefinitions[heroName];
    const skillEntries = Object.entries(definition.skills);
    assert.equal(skillEntries.length, 4);
    assert.equal(skillEntries[3][0], skillName);
    assert.equal(Object.values(skillEntries[3][1].effects)[0].type, effectType);
    assert.deepEqual(skillEntries[3][1].requirements, [
      { level: 1, type: "engagement_type", value: engagement }
    ]);

    const matchingSide = engagement === "rally" ? "attacker" : "defender";
    const gatedOutSide = engagement === "rally" ? "defender" : "attacker";
    const matching = resolveFighter(
      { troops: { infantry_t1: 1 }, heroes: { [heroName]: { skill_4: 5 } } },
      matchingSide,
      config,
      "rally"
    );
    const gatedOut = resolveFighter(
      { troops: { infantry_t1: 1 }, heroes: { [heroName]: { skill_4: 5 } } },
      gatedOutSide,
      config,
      "rally"
    );
    assert.deepEqual(matching.heroes[0]?.skillIds, [skillName]);
    assert.deepEqual(gatedOut.heroes[0]?.skillIds, []);
  }
});

test("Gen8 combat skill values and active effect buckets match their definitions", () => {
  const config = loadSimulatorConfig();
  const gatot = config.heroDefinitions.Gatot.skills;
  const sonya = config.heroDefinitions.Sonya.skills;
  const hendrik = config.heroDefinitions.Hendrik.skills;

  assert.deepEqual(gatot.GoldenGuard.effects["GoldenGuard/1"].value, [6, 12, 18, 24, 30]);
  assert.equal(gatot.GoldenGuard.effects["GoldenGuard/1"].type, "active.hero.defense.up");
  assert.deepEqual(gatot.KingsBestowal.effects["KingsBestowal/1"].value, [6, 12, 18, 24, 30]);
  assert.deepEqual(gatot.KingsBestowal.effects["KingsBestowal/1"], {
    type: "active.hero.shield",
    value: [6, 12, 18, 24, 30],
    value_formula: { type: "percent_of", source: "trigger.source_attack" },
    units: { applies_to: "trigger.source", applies_vs: "enemy.any" },
    duration: { turns: { delay: 1, count: 1 } },
    same_effect_stacking: "max"
  });
  assert.deepEqual(gatot.RoyalLegion.effects["RoyalLegion/1"].value, [5, 10, 15, 20, 25]);
  assert.equal(gatot.RoyalLegion.effects["RoyalLegion/1"].type, "active.hero.attack.down");

  assert.deepEqual(sonya.TreasureHunter.effects["TreasureHunter/1"].value, [4, 8, 12, 16, 20]);
  assert.equal(sonya.BountyTemptation.effects["BountyTemptation/1"].type, "extra_skill_attack");
  assert.deepEqual(sonya.BountyTemptation.effects["BountyTemptation/1"].value, [15, 30, 45, 60, 75]);
  assert.deepEqual(sonya.BountyTemptation.effects["BountyTemptation/1"].trigger_damage_jobs, [
    { source: "use.source", target: "use.target" }
  ]);
  assert.equal(sonya.BountyTemptation.effects["BountyTemptation/2"].type, "active.hero.attack.up");
  assert.deepEqual(sonya.TorrentialImpact.effects["TorrentialImpact/1"].value, [50, 100, 150, 200, 250]);
  assert.equal(sonya.TorrentialImpact.effects["TorrentialImpact/1"].type, "extra_skill_attack");
  assert.deepEqual(sonya.TorrentialImpact.effects["TorrentialImpact/1"].trigger_damage_jobs, [
    { source: "use.source", target: "use.target" }
  ]);
  assert.equal(sonya.TorrentialImpact.effects["TorrentialImpact/2"].type, "no_attack");

  assert.deepEqual(hendrik.WormsRavage.effects["WormsRavage/1"].value, [5, 10, 15, 20, 25]);
  assert.equal(hendrik.WormsRavage.effects["WormsRavage/1"].type, "active.hero.defense.down");
  assert.deepEqual(hendrik.ArmorOfBarnacles.effects["ArmorOfBarnacles/1"].value, [6, 12, 18, 24, 30]);
  assert.equal(hendrik.ArmorOfBarnacles.effects["ArmorOfBarnacles/1"].type, "active.hero.defense.up");
  assert.deepEqual(hendrik.DragonsHeir.effects["DragonsHeir/1"].value, [8, 16, 24, 32, 40]);
  assert.equal(hendrik.DragonsHeir.effects["DragonsHeir/1"].type, "extra_skill_attack");
  assert.deepEqual(hendrik.DragonsHeir.effects["DragonsHeir/1"].trigger_damage_jobs, [
    { source: "use.source", target: "enemy.living" }
  ]);
});

test("Gatot converts source formation Attack into next-turn shield protection", () => {
  const config = loadSimulatorConfig();
  const input = gatotInfantryBattle(5000, 1000, 2);
  const result = simulateBattles(input, config, { mode: "trace" })[0]!;
  const roundTwoLeftAttack = result.attacks.find(
    (attack) => attack.round === 2 && attack.kind === "normal" && attack.dealerSide === "attacker"
  );
  const rightShield = roundTwoLeftAttack?.appliedEffects?.find((effect) => "kind" in effect && effect.kind === "shield");
  const expectedRightShield = Math.sqrt(1000) * (243 * (1 + 326.1 / 100)) / (730 * (1 + 18.2 / 100)) * 0.12;

  assert.ok(rightShield && "value" in rightShield);
  assert.ok(Math.abs(rightShield.value - expectedRightShield) < 1e-12);
  assert.equal(roundTwoLeftAttack?.kills, Math.max(0, (roundTwoLeftAttack?.trace?.damageBeforeOffsets ?? 0) - expectedRightShield));
});

test("Gatot source-Attack shields reproduce the observed army-size threshold", () => {
  const config = loadSimulatorConfig();
  const expectations = [
    { left: 4900, right: 1000, winner: "draw", rounds: 1500, leftLosses: 3, rightLosses: 4 },
    { left: 5100, right: 1000, winner: "attacker", rounds: 1374, leftLosses: 3, rightLosses: 1000 },
    { left: 10000, right: 2000, winner: "attacker", rounds: 452, leftLosses: 7, rightLosses: 2000 },
    { left: 20000, right: 4000, winner: "attacker", rounds: 337, leftLosses: 14, rightLosses: 4000 }
  ] as const;

  for (const expected of expectations) {
    const result = simulateBattles(gatotInfantryBattle(expected.left, expected.right), config, { mode: "fast" })[0]!;
    assert.deepEqual(
      {
        winner: result.winner,
        rounds: result.rounds,
        leftLosses: expected.left - result.remaining.attacker.infantry,
        rightLosses: expected.right - result.remaining.defender.infantry
      },
      {
        winner: expected.winner,
        rounds: expected.rounds,
        leftLosses: expected.leftLosses,
        rightLosses: expected.rightLosses
      }
    );
  }
});

test("Gatot turn shields split protection across mixed enemy formations", () => {
  const input: BattleInput = {
    maxRounds: 1500,
    seed: "10024f8d-b3e3-423a-832c-5176cfbbbd7d",
    attacker: {
      troops: { infantry_t6: 5000 },
      stats: { infantry: { attack: 295.3, defense: 293.3, lethality: 10, health: 10 } },
      heroes: { Gatot: { skill_1: 1, skill_2: 3, skill_3: 3 } }
    },
    defender: {
      troops: { infantry_t6: 1000, lancer_t6: 10 },
      stats: {
        infantry: { attack: 326.1, defense: 330.1, lethality: 18.2, health: 18.2 },
        lancer: { attack: 284.8, defense: 288.8, lethality: 18.2, health: 18.2 }
      },
      heroes: {
        Gatot: { skill_1: 2, skill_2: 2, skill_3: 2 },
        Gordon: { skill_1: 3, skill_2: 3, skill_3: 3 }
      }
    }
  };

  const result = simulateBattles(input, loadSimulatorConfig(), { mode: "fast" })[0]!;

  assert.deepEqual(
    { winner: result.winner, rounds: result.rounds, leftInfantry: result.remaining.attacker.infantry },
    { winner: "attacker", rounds: 1153, leftInfantry: 4557 }
  );
  assert.deepEqual(result.remaining.defender, { infantry: 0, lancer: 0, marksman: 0 });
});

function gatotInfantryBattle(left: number, right: number, maxRounds = 1500): BattleInput {
  return {
    maxRounds,
    seed: "gatot-source-attack-shield",
    attacker: {
      troops: { infantry_t6: left },
      stats: { infantry: { attack: 285.3, defense: 283.3, lethality: 0, health: 0 } },
      heroes: { Gatot: { skill_1: 1, skill_2: 2, skill_3: 3 } }
    },
    defender: {
      troops: { infantry_t6: right },
      stats: { infantry: { attack: 326.1, defense: 330.1, lethality: 18.2, health: 18.2 } },
      heroes: { Gatot: { skill_1: 2, skill_2: 2, skill_3: 2 } }
    }
  };
}
