import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { tmpdir } from "node:os";

import { loadSimulatorConfig } from "./config.js";
import { UNIT_TYPES } from "./types.js";
import type { EffectIntentDefinition, SkillFile, TriggerDamageJobDefinition } from "./types.js";

test("loadSimulatorConfig loads native v3 catalogues and reports effect inventory", () => {
  const config = loadSimulatorConfig();

  assert.ok(config.troopStats.infantry_t6);
  assert.ok(config.heroGenerationStats.S2);
  assert.ok(config.heroDefinitions.Alonso);
  assert.equal(config.heroDefinitions.Alonso.hero_generation, "S2");
  assert.ok(config.troopSkills.skills.MasterBrawler);
  assert.equal(config.diagnostics.legacyFields.length, 0);
  assert.ok(config.diagnostics.effectTypes.damage_up > 0);
  assert.ok(config.diagnostics.effectTypes.extra_skill_attack > 0);
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

  assert.throws(() => loadSimulatorConfig({ configDir: root }), /legacy field/i);
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

  assert.throws(() => loadSimulatorConfig({ configDir: root }), /duplicate hero alias.*samehero/i);
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

test("loadSimulatorConfig rejects invalid trigger_damage_jobs selector strings", () => {
  const root = writeConfigWithTroopEffect({
    type: "extra_skill_attack",
    value: 100,
    units: { applies_to: "trigger.source", applies_vs: "trigger.target" },
    trigger_damage_jobs: [{ source: "use.source", target: "activation.targte" }]
  });

  assert.throws(() => loadSimulatorConfig({ configDir: root }), /invalid trigger_damage_jobs target selector.*activation\.targte/i);
});

test("loadSimulatorConfig rejects trigger_damage_jobs with typoed keys", () => {
  const root = writeConfigWithTroopEffect({
    type: "extra_skill_attack",
    value: 100,
    units: { applies_to: "trigger.source", applies_vs: "trigger.target" },
    trigger_damage_jobs: [{ soruce: "use.source", target: "activation.target" }]
  });

  assert.throws(() => loadSimulatorConfig({ configDir: root }), /unknown trigger_damage_jobs key soruce/i);
});

test("loadSimulatorConfig requires trigger_damage_jobs source and target", () => {
  const missingSourceRoot = writeConfigWithTroopEffect({
    type: "extra_skill_attack",
    value: 100,
    units: { applies_to: "trigger.source", applies_vs: "trigger.target" },
    trigger_damage_jobs: [{ target: "activation.target" }]
  });
  const missingTargetRoot = writeConfigWithTroopEffect({
    type: "extra_skill_attack",
    value: 100,
    units: { applies_to: "trigger.source", applies_vs: "trigger.target" },
    trigger_damage_jobs: [{ source: "use.source" }]
  });

  assert.throws(() => loadSimulatorConfig({ configDir: missingSourceRoot }), /requires source/i);
  assert.throws(() => loadSimulatorConfig({ configDir: missingTargetRoot }), /requires target/i);
});

test('loadSimulatorConfig rejects activation.target jobs gated by applies_vs "any"', () => {
  const root = writeConfigWithTroopEffect({
    type: "extra_skill_attack",
    value: 100,
    units: { applies_to: "trigger.source", applies_vs: "any" },
    trigger_damage_jobs: [{ source: "use.source", target: "activation.target" }]
  });

  assert.throws(() => loadSimulatorConfig({ configDir: root }), /activation\.target.*applies_vs.*any/i);
});

test("loadSimulatorConfig rejects activation.target jobs without activation-concrete applies_vs", () => {
  const omittedRoot = writeConfigWithTroopEffect({
    type: "extra_skill_attack",
    value: 100,
    units: { applies_to: "trigger.source" },
    trigger_damage_jobs: [{ source: "use.source", target: "activation.target" }]
  });
  const allRoot = writeConfigWithTroopEffect({
    type: "extra_skill_attack",
    value: 100,
    units: { applies_to: "trigger.source", applies_vs: "all" },
    trigger_damage_jobs: [{ source: "use.source", target: "activation.target" }]
  });

  assert.throws(() => loadSimulatorConfig({ configDir: omittedRoot }), /activation\.target.*concrete applies_vs/i);
  assert.throws(() => loadSimulatorConfig({ configDir: allRoot }), /activation\.target.*applies_vs.*all/i);
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
        if (job.target === "activation.target" && !isActivationConcreteAppliesVs(intent.units?.applies_vs)) {
          violations.push(
            `${file}:${skillId}.${effectId}.trigger_damage_jobs[${index}].target uses activation.target with non-concrete applies_vs ${JSON.stringify(intent.units?.applies_vs)}`
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
  const supported = new Set(["use.source", "use.target", "activation.source", "activation.target", "enemy.living", "self.living"]);
  if (typeof selector === "string") return supported.has(selector) || (UNIT_TYPES as string[]).includes(selector);
  if (Array.isArray(selector)) return selector.length > 0 && selector.every((entry) => typeof entry === "string" && (UNIT_TYPES as string[]).includes(entry));
  return false;
}

function isActivationConcreteAppliesVs(selector: unknown): boolean {
  if (selector === "trigger.target" || selector === "target") return true;
  if (typeof selector === "string") return (UNIT_TYPES as string[]).includes(selector);
  if (Array.isArray(selector)) return selector.length > 0 && selector.every((entry) => typeof entry === "string" && (UNIT_TYPES as string[]).includes(entry));
  return false;
}

function writeConfigWithTroopEffect(effect: Record<string, unknown>): string {
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
          trigger: { type: "attack" },
          effects: { "ExampleSkill/1": effect }
        }
      }
    })
  );
  return root;
}
