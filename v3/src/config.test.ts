import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { tmpdir } from "node:os";

import { loadSimulatorConfig } from "./config.js";
import type { EffectIntentDefinition, SkillFile } from "./types.js";

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
