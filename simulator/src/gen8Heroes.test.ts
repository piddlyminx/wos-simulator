import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSimulatorConfig } from "./config";
import { resolveFighter } from "./fighterResolution";

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
    value_formula: { type: "percent_of", source: "trigger.total_kills" },
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
