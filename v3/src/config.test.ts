import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { loadSimulatorConfig } from "./config";
import { loadSimulatorConfigFromDir } from "./config-node";
import { UNIT_TYPES } from "./types";
import type { EffectIntentDefinition, SkillFile, TriggerDamageJobDefinition } from "./types";

test("loadSimulatorConfig loads native v3 catalogues and reports effect inventory", () => {
  const config = loadSimulatorConfig();

  assert.ok(config.troopStats.infantry_t6);
  assert.ok(config.heroGenerationStats.S2);
  assert.ok(config.heroDefinitions.Alonso);
  assert.equal(config.heroDefinitions.Alonso.hero_generation, "S2");
  assert.ok(config.troopSkills.skills.MasterBrawler);
  assert.equal(config.diagnostics.legacyFields.length, 0);
  assert.equal(config.diagnostics.ambiguousTurnTriggerSelectors.length, 0);
  assert.ok(config.diagnostics.effectTypes["active.hero.lethality.up"] > 0);
  assert.ok(config.diagnostics.effectTypes.extra_skill_attack > 0);
});

test("T11 fire crystal troop stats use expected FC5+ base values", () => {
  const config = loadSimulatorConfig();
  const dashboardTroopStats = JSON.parse(readFileSync(fileURLToPath(new URL("../../assets/troop_stats.json", import.meta.url)), "utf8")) as typeof config.troopStats;
  const expected = {
    5: {
      infantry: { Attack: 658, Defense: 10, Lethality: 10, Health: 1973 },
      lancer: { Attack: 1973, Defense: 10, Lethality: 10, Health: 658 },
      marksman: { Attack: 2632, Defense: 10, Lethality: 10, Health: 494 }
    },
    6: {
      infantry: { Attack: 691, Defense: 10, Lethality: 10, Health: 2072 },
      lancer: { Attack: 2072, Defense: 10, Lethality: 10, Health: 691 },
      marksman: { Attack: 2764, Defense: 10, Lethality: 10, Health: 519 }
    },
    7: {
      infantry: { Attack: 726, Defense: 10, Lethality: 10, Health: 2176 },
      lancer: { Attack: 2176, Defense: 10, Lethality: 10, Health: 726 },
      marksman: { Attack: 2902, Defense: 10, Lethality: 10, Health: 545 }
    },
    8: {
      infantry: { Attack: 762, Defense: 10, Lethality: 10, Health: 2285 },
      lancer: { Attack: 2285, Defense: 10, Lethality: 10, Health: 762 },
      marksman: { Attack: 3047, Defense: 10, Lethality: 10, Health: 572 }
    }
  } as const;
  const idFor = (unit: keyof (typeof expected)[5], fc: number) => `${unit}_t11_fc${fc}`;

  for (const [fcKey, byUnit] of Object.entries(expected)) {
    const fc = Number(fcKey);
    for (const [unit, stats] of Object.entries(byUnit) as Array<[keyof typeof byUnit, (typeof byUnit)[keyof typeof byUnit]]>) {
      const id = idFor(unit, fc);

      assert.deepEqual(config.troopStats[id]?.stats, stats);
      assert.deepEqual(dashboardTroopStats[id], config.troopStats[id]);
    }

    assert.equal(byUnit.infantry.Attack, byUnit.lancer.Health);
    assert.equal(byUnit.infantry.Health, byUnit.lancer.Attack);
    assert.ok(Math.abs(byUnit.marksman.Attack - (byUnit.lancer.Attack * 4) / 3) <= 2);
    assert.ok(Math.abs(byUnit.marksman.Health - (byUnit.lancer.Health * 3) / 4) <= 1);

    if (fc > 5) {
      const previous = expected[(fc - 1) as keyof typeof expected];
      assert.ok(byUnit.infantry.Attack > previous.infantry.Attack);
      assert.ok(byUnit.lancer.Attack > previous.lancer.Attack);
      assert.ok(byUnit.marksman.Attack > previous.marksman.Attack);
    }
  }
});

test("loadSimulatorConfig warns for non-per-unit turn triggers with trigger-relative effect selectors", () => {
  const root = writeConfigWithTroopEffect({
    type: "active.hero.lethality.up",
    value: 10,
    units: { applies_to: "trigger.source", applies_vs: "target" }
  });

  const config = loadSimulatorConfigFromDir(root);

  assert.deepEqual(config.diagnostics.ambiguousTurnTriggerSelectors, [
    {
      file: relative(process.cwd(), join(root, "troop_skills.json")),
      skillId: "ExampleSkill",
      effectId: "ExampleSkill/1",
      selector: "trigger.source",
      reason: "Turn trigger has no concrete attack intent; trigger-relative unit selectors fall back to all units"
    },
    {
      file: relative(process.cwd(), join(root, "troop_skills.json")),
      skillId: "ExampleSkill",
      effectId: "ExampleSkill/1",
      selector: "target",
      reason: "Turn trigger has no concrete attack intent; trigger-relative unit selectors fall back to all units"
    }
  ]);
});

test("loadSimulatorConfig rejects legacy fields in v3 config", () => {
  const root = join(tmpdir(), `wos-v3-config-${Date.now()}`);
  mkdirSync(join(root, "hero_definitions"), { recursive: true });
  writeFileSync(
    join(root, "troop_stats.json"),
    JSON.stringify({
      infantry_t1: {
        id: "infantry_t1",
        type: "infantry",
        tier: 1,
        fc: 0,
        legacy: true,
        stats: { Attack: 1, Defense: 1, Lethality: 1, Health: 1 }
      }
    })
  );
  writeFileSync(join(root, "hero_generation_stats.json"), JSON.stringify({ S1: { attack: 1, defense: 1, lethality: 1, health: 1 } }));
  writeFileSync(join(root, "troop_skills.json"), JSON.stringify({ name: "Troop Skills", skills: {} }));
  writeFileSync(join(root, "hero_definitions", "Example.json"), JSON.stringify({ name: "Example", hero_generation: "S1", skills: {} }));

  assert.throws(() => loadSimulatorConfigFromDir(root), /legacy field/i);
});

test("loadSimulatorConfig rejects legacy effect metadata fields without naming them in source", () => {
  const legacyEffectMetadataKey = ["effect", "op"].join("_");
  const root = writeConfigWithTroopEffect({
    type: "active.hero.lethality.up",
    value: 10,
    units: { applies_to: "trigger.source", applies_vs: "target" },
    [legacyEffectMetadataKey]: 101
  });

  assert.throws(() => loadSimulatorConfigFromDir(root), /legacy field/i);
});

test("v3 config source does not reference legacy effect metadata names", () => {
  const legacyEffectMetadataKey = ["effect", "op"].join("_");
  const source = readFileSync(fileURLToPath(new URL("./config.ts", import.meta.url)), "utf8");

  assert.equal(source.includes(legacyEffectMetadataKey), false);
});

test("loadSimulatorConfig rejects duplicate normalized hero aliases", () => {
  const root = join(tmpdir(), `wos-v3-config-alias-${Date.now()}`);
  mkdirSync(join(root, "hero_definitions"), { recursive: true });
  writeFileSync(
    join(root, "troop_stats.json"),
    JSON.stringify({
      infantry_t1: {
        id: "infantry_t1",
        type: "infantry",
        tier: 1,
        fc: 0,
        stats: { Attack: 1, Defense: 1, Lethality: 1, Health: 1 }
      }
    })
  );
  writeFileSync(join(root, "hero_generation_stats.json"), JSON.stringify({ S1: { attack: 1, defense: 1, lethality: 1, health: 1 } }));
  writeFileSync(join(root, "troop_skills.json"), JSON.stringify({ name: "Troop Skills", skills: {} }));
  writeFileSync(join(root, "hero_definitions", "Alpha.json"), JSON.stringify({ name: "Same Hero", hero_generation: "S1", skills: {} }));
  writeFileSync(join(root, "hero_definitions", "Beta.json"), JSON.stringify({ name: "Same-Hero", hero_generation: "S1", skills: {} }));

  assert.throws(() => loadSimulatorConfigFromDir(root), /duplicate hero alias.*samehero/i);
});

test("native v3 extra skill attacks define trigger_damage_jobs", () => {
  const config = loadSimulatorConfig();
  const missing: string[] = [];

  collectMissingTriggerDamageJobs("config/troop_skills.json", config.troopSkills, missing);
  for (const [heroName, heroDefinition] of Object.entries(config.heroDefinitions)) {
    collectMissingTriggerDamageJobs(`config/hero_definitions/${heroName}.json`, heroDefinition, missing);
  }

  assert.deepEqual(missing, []);
});

test("native v3 trigger_damage_jobs use validated selectors and scalar multipliers", () => {
  const config = loadSimulatorConfig();
  const violations: string[] = [];

  collectTriggerDamageJobViolations("config/troop_skills.json", config.troopSkills, violations);
  for (const [heroName, heroDefinition] of Object.entries(config.heroDefinitions)) {
    collectTriggerDamageJobViolations(`config/hero_definitions/${heroName}.json`, heroDefinition, violations);
  }

  assert.deepEqual(violations, []);
});

test("Wayne Fleet is modeled as a chance extra skill attack against the same target", () => {
  const config = loadSimulatorConfig();
  const fleet = config.heroDefinitions.Wayne.skills.Fleet.effects["Fleet/1"] as EffectIntentDefinition;

  assert.equal(fleet.type, "extra_skill_attack");
  assert.deepEqual(fleet.value, [100, 100, 100, 100, 100]);
  assert.deepEqual(fleet.units, { applies_to: "trigger.source", applies_vs: "trigger.target" });
  assert.deepEqual(fleet.trigger_damage_jobs, [{ source: "use.source", target: "use.target" }]);
});

test('native v3 effects do not use applies_vs "all"', () => {
  const config = loadSimulatorConfig();
  const offenders: string[] = [];

  collectAppliesVsAllOffenders("config/troop_skills.json", config.troopSkills, offenders);
  for (const [heroName, heroDefinition] of Object.entries(config.heroDefinitions)) {
    collectAppliesVsAllOffenders(`config/hero_definitions/${heroName}.json`, heroDefinition, offenders);
  }

  assert.deepEqual(offenders, []);
});

test("native v3 triggers do not use legacy units filters", () => {
  const config = loadSimulatorConfig();
  const offenders: string[] = [];

  collectLegacyTriggerUnitsOffenders("config/troop_skills.json", config.troopSkills, offenders);
  for (const [heroName, heroDefinition] of Object.entries(config.heroDefinitions)) {
    collectLegacyTriggerUnitsOffenders(`config/hero_definitions/${heroName}.json`, heroDefinition, offenders);
  }

  assert.deepEqual(offenders, []);
});

test("native v3 effects do not use units.side", () => {
  const config = loadSimulatorConfig();
  const offenders: string[] = [];

  collectEffectUnitsSideOffenders("config/troop_skills.json", config.troopSkills, offenders);
  for (const [heroName, heroDefinition] of Object.entries(config.heroDefinitions)) {
    collectEffectUnitsSideOffenders(`config/hero_definitions/${heroName}.json`, heroDefinition, offenders);
  }

  assert.deepEqual(offenders, []);
});

test("loadSimulatorConfig rejects legacy trigger units filters", () => {
  const root = writeConfigWithTroopEffect({
    type: "active.hero.lethality.up",
    value: 10,
    units: { applies_to: "trigger.source", applies_vs: "target" }
  });
  const troopSkills = JSON.parse(readFileSync(join(root, "troop_skills.json"), "utf8")) as SkillFile;
  troopSkills.skills.ExampleSkill.trigger = { type: "attack", units: { side: "enemy", applies_vs: ["infantry"] } } as never;
  writeFileSync(join(root, "troop_skills.json"), JSON.stringify(troopSkills));

  assert.throws(() => loadSimulatorConfigFromDir(root), /legacy trigger units/i);
});

test('loadSimulatorConfig rejects native effect applies_vs "all"', () => {
  const root = writeConfigWithTroopEffect({
    type: "active.hero.lethality.up",
    value: 10,
    units: { applies_to: "trigger.source", applies_vs: "all" }
  });

  assert.throws(() => loadSimulatorConfigFromDir(root), /applies_vs.*all/i);
});

test("loadSimulatorConfig rejects native effect units.side", () => {
  const root = writeConfigWithTroopEffect({
    type: "active.hero.lethality.up",
    value: 10,
    units: { side: "enemy", applies_to: "target" }
  });

  assert.throws(() => loadSimulatorConfigFromDir(root), /units\.side/i);
});

test("loadSimulatorConfig rejects trigger-relative effect selectors on battle_start triggers", () => {
  const root = writeConfigWithTroopEffect(
    {
      type: "active.hero.lethality.up",
      value: 10,
      units: { applies_to: "trigger" }
    },
    { type: "battle_start" }
  );

  assert.throws(() => loadSimulatorConfigFromDir(root), /battle_start.*trigger-relative.*applies_to.*trigger/i);
});

test("loadSimulatorConfig rejects negative native bucket effect values", () => {
  const root = writeConfigWithTroopEffect({
    type: "active.hero.attack.down",
    value: -10,
    units: { applies_to: "trigger.source", applies_vs: "target" }
  });

  assert.throws(() => loadSimulatorConfigFromDir(root), /negative.*active\.hero\.attack\.down.*value/i);
});

test("loadSimulatorConfig rejects passive effects that are not battle-start static", () => {
  const turnRoot = writeConfigWithTroopEffect({
    type: "passive.attack.up",
    value: 10
  });
  const durationRoot = writeConfigWithTroopEffect(
    {
      type: "passive.attack.up",
      value: 10,
      duration: { type: "round", value: 1 }
    },
    { type: "battle_start" }
  );
  const evolvingRoot = writeConfigWithTroopEffect(
    {
      type: "passive.attack.up",
      value: 10,
      value_evolution: { type: "fixed_decay", step: "round", value: 1 }
    },
    { type: "battle_start" }
  );

  assert.throws(() => loadSimulatorConfigFromDir(turnRoot), /passive.*battle_start/i);
  assert.throws(() => loadSimulatorConfigFromDir(durationRoot), /passive.*battle.*duration/i);
  assert.throws(() => loadSimulatorConfigFromDir(evolvingRoot), /passive.*value_evolution/i);
});

test("loadSimulatorConfig rejects invalid trigger_damage_jobs selector strings", () => {
  const root = writeConfigWithTroopEffect({
    type: "extra_skill_attack",
    value: 100,
    units: { applies_to: "trigger.source", applies_vs: "trigger.target" },
    trigger_damage_jobs: [{ source: "use.source", target: "effect.applies_v" }]
  });

  assert.throws(() => loadSimulatorConfigFromDir(root), /invalid trigger_damage_jobs target selector.*effect\.applies_v/i);
});

test("loadSimulatorConfig rejects trigger_damage_jobs with typoed keys", () => {
  const root = writeConfigWithTroopEffect({
    type: "extra_skill_attack",
    value: 100,
    units: { applies_to: "trigger.source", applies_vs: "trigger.target" },
    trigger_damage_jobs: [{ soruce: "use.source", target: "effect.applies_vs" }]
  });

  assert.throws(() => loadSimulatorConfigFromDir(root), /unknown trigger_damage_jobs key soruce/i);
});

test("loadSimulatorConfig requires trigger_damage_jobs source and target", () => {
  const missingSourceRoot = writeConfigWithTroopEffect({
    type: "extra_skill_attack",
    value: 100,
    units: { applies_to: "trigger.source", applies_vs: "trigger.target" },
    trigger_damage_jobs: [{ target: "effect.applies_vs" }]
  });
  const missingTargetRoot = writeConfigWithTroopEffect({
    type: "extra_skill_attack",
    value: 100,
    units: { applies_to: "trigger.source", applies_vs: "trigger.target" },
    trigger_damage_jobs: [{ source: "use.source" }]
  });

  assert.throws(() => loadSimulatorConfigFromDir(missingSourceRoot), /requires source/i);
  assert.throws(() => loadSimulatorConfigFromDir(missingTargetRoot), /requires target/i);
});

test('loadSimulatorConfig rejects effect.applies_vs jobs gated by applies_vs "any"', () => {
  const root = writeConfigWithTroopEffect({
    type: "extra_skill_attack",
    value: 100,
    units: { applies_to: "trigger.source", applies_vs: "any" },
    trigger_damage_jobs: [{ source: "use.source", target: "effect.applies_vs" }]
  });

  assert.throws(() => loadSimulatorConfigFromDir(root), /effect\.applies_vs.*applies_vs.*any/i);
});

test("loadSimulatorConfig rejects effect.applies_vs jobs without concrete applies_vs", () => {
  const omittedRoot = writeConfigWithTroopEffect({
    type: "extra_skill_attack",
    value: 100,
    units: { applies_to: "trigger.source" },
    trigger_damage_jobs: [{ source: "use.source", target: "effect.applies_vs" }]
  });
  const allRoot = writeConfigWithTroopEffect({
    type: "extra_skill_attack",
    value: 100,
    units: { applies_to: "trigger.source", applies_vs: "all" },
    trigger_damage_jobs: [{ source: "use.source", target: "effect.applies_vs" }]
  });

  assert.throws(() => loadSimulatorConfigFromDir(omittedRoot), /effect\.applies_vs.*concrete applies_vs/i);
  assert.throws(() => loadSimulatorConfigFromDir(allRoot), /applies_vs.*all/i);
});

function collectMissingTriggerDamageJobs(file: string, skillFile: SkillFile, missing: string[]): void {
  for (const [skillId, skill] of Object.entries(skillFile.skills ?? {})) {
    for (const [effectId, effect] of Object.entries(skill.effects ?? {})) {
      const intent = effect as EffectIntentDefinition;
      if (intent.type === "extra_skill_attack" && (!intent.trigger_damage_jobs || intent.trigger_damage_jobs.length === 0)) {
        missing.push(`${file}:${skillId}.${effectId}`);
      }
    }
  }
}

function collectAppliesVsAllOffenders(file: string, skillFile: SkillFile, offenders: string[]): void {
  for (const [skillId, skill] of Object.entries(skillFile.skills ?? {})) {
    for (const [effectId, effect] of Object.entries(skill.effects ?? {})) {
      const intent = effect as EffectIntentDefinition;
      if (intent.units?.applies_vs === "all") {
        offenders.push(`${file}:${skillId}.${effectId}`);
      }
    }
  }
}

function collectLegacyTriggerUnitsOffenders(file: string, skillFile: SkillFile, offenders: string[]): void {
  for (const [skillId, skill] of Object.entries(skillFile.skills ?? {})) {
    if (skill.trigger && "units" in skill.trigger) {
      offenders.push(`${file}:${skillId}.trigger.units`);
    }
  }
}

function collectEffectUnitsSideOffenders(file: string, skillFile: SkillFile, offenders: string[]): void {
  for (const [skillId, skill] of Object.entries(skillFile.skills ?? {})) {
    for (const [effectId, effect] of Object.entries(skill.effects ?? {})) {
      const intent = effect as EffectIntentDefinition;
      if (intent.units && "side" in intent.units) {
        offenders.push(`${file}:${skillId}.${effectId}.units.side`);
      }
    }
  }
}

function collectTriggerDamageJobViolations(file: string, skillFile: SkillFile, violations: string[]): void {
  for (const [skillId, skill] of Object.entries(skillFile.skills ?? {})) {
    for (const [effectId, effect] of Object.entries(skill.effects ?? {})) {
      const intent = effect as EffectIntentDefinition;
      if (intent.type !== "extra_skill_attack") continue;
      if (!Array.isArray(intent.trigger_damage_jobs)) continue;
      intent.trigger_damage_jobs.forEach((job, index) => {
        collectJobShapeViolation(file, skillId, effectId, index, job, violations);
        collectSelectorViolation(file, skillId, effectId, index, "source", job.source, violations);
        collectSelectorViolation(file, skillId, effectId, index, "target", job.target, violations);
        if (job.target === "effect.applies_vs" && !isEffectAppliesVsConcrete(intent.units?.applies_vs)) {
          violations.push(
            `${file}:${skillId}.${effectId}.trigger_damage_jobs[${index}].target uses effect.applies_vs with non-concrete applies_vs ${JSON.stringify(intent.units?.applies_vs)}`
          );
        }
        if (job.multiplier !== undefined && typeof job.multiplier !== "number") {
          violations.push(`${file}:${skillId}.${effectId}.trigger_damage_jobs[${index}].multiplier must be a number`);
        }
      });
    }
  }
}

function collectJobShapeViolation(
  file: string,
  skillId: string,
  effectId: string,
  jobIndex: number,
  job: TriggerDamageJobDefinition,
  violations: string[]
): void {
  const allowedKeys = new Set(["source", "target", "multiplier"]);
  for (const key of Object.keys(job)) {
    if (!allowedKeys.has(key)) {
      violations.push(`${file}:${skillId}.${effectId}.trigger_damage_jobs[${jobIndex}] has unknown key ${key}`);
    }
  }
  if (job.source === undefined) {
    violations.push(`${file}:${skillId}.${effectId}.trigger_damage_jobs[${jobIndex}] is missing source`);
  }
  if (job.target === undefined) {
    violations.push(`${file}:${skillId}.${effectId}.trigger_damage_jobs[${jobIndex}] is missing target`);
  }
}

function collectSelectorViolation(
  file: string,
  skillId: string,
  effectId: string,
  jobIndex: number,
  role: "source" | "target",
  selector: TriggerDamageJobDefinition["source"],
  violations: string[]
): void {
  if (selector === undefined) return;
  if (isAllowedTriggerDamageJobSelector(selector)) return;
  violations.push(`${file}:${skillId}.${effectId}.trigger_damage_jobs[${jobIndex}].${role} has invalid selector ${JSON.stringify(selector)}`);
}

function isAllowedTriggerDamageJobSelector(selector: TriggerDamageJobDefinition["source"]): boolean {
  const supported = new Set(["use.source", "use.target", "effect.applies_to", "effect.applies_vs", "enemy.living", "self.living"]);
  if (typeof selector === "string") return supported.has(selector) || (UNIT_TYPES as string[]).includes(selector);
  if (Array.isArray(selector)) return selector.length > 0 && selector.every((entry) => typeof entry === "string" && (UNIT_TYPES as string[]).includes(entry));
  return false;
}

function isEffectAppliesVsConcrete(selector: unknown): boolean {
  if (selector === "trigger.target" || selector === "target") return true;
  if (typeof selector === "string") return (UNIT_TYPES as string[]).includes(selector);
  if (Array.isArray(selector)) return selector.length > 0 && selector.every((entry) => typeof entry === "string" && (UNIT_TYPES as string[]).includes(entry));
  return false;
}

function writeConfigWithTroopEffect(effect: Record<string, unknown>, trigger: Record<string, unknown> = { type: "turn" }): string {
  const root = join(tmpdir(), `wos-v3-config-trigger-jobs-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(root, "hero_definitions"), { recursive: true });
  writeFileSync(
    join(root, "troop_stats.json"),
    JSON.stringify({
      infantry_t1: {
        id: "infantry_t1",
        type: "infantry",
        tier: 1,
        fc: 0,
        stats: { Attack: 1, Defense: 1, Lethality: 1, Health: 1 }
      }
    })
  );
  writeFileSync(join(root, "hero_generation_stats.json"), JSON.stringify({ S1: { attack: 1, defense: 1, lethality: 1, health: 1 } }));
  writeFileSync(
    join(root, "troop_skills.json"),
    JSON.stringify({
      name: "Troop Skills",
      skills: {
        ExampleSkill: {
          trigger,
          effects: { "ExampleSkill/1": effect }
        }
      }
    })
  );
  return root;
}
