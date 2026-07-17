import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { loadSimulatorConfig } from "./config";
import { loadSimulatorConfigFromDir } from "./config-node";
import type { SkillFile } from "./types";

test("Gwen Blastmaster uses a turn delay and a one-attack duration", () => {
  const effect = loadSimulatorConfig().heroDefinitions.Gwen.skills.Blastmaster.effects["Blastmaster/1"];

  assert.deepEqual(effect.duration, {
    turns: { delay: 1 },
    attacks: { count: 1 }
  });
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

test("loadSimulatorConfig rejects legacy fields in simulator config", () => {
  const root = join(tmpdir(), `wos-simulator-config-${Date.now()}`);
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

test("loadSimulatorConfig rejects legacy duration shape", () => {
  const root = writeConfigWithTroopEffect({
    type: "active.hero.lethality.up",
    value: 10,
    units: { applies_to: "trigger.source", applies_vs: "target" },
    duration: { type: "attack", value: 1 } as never
  });

  assert.throws(() => loadSimulatorConfigFromDir(root), /duration key type.*not supported/i);
});

test("simulator config source does not reference legacy effect metadata names", () => {
  const legacyEffectMetadataKey = ["effect", "op"].join("_");
  const source = readFileSync(fileURLToPath(new URL("./config.ts", import.meta.url)), "utf8");

  assert.equal(source.includes(legacyEffectMetadataKey), false);
});

test("loadSimulatorConfig rejects duplicate normalized hero aliases", () => {
  const root = join(tmpdir(), `wos-simulator-config-alias-${Date.now()}`);
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

test("loadSimulatorConfig rejects invalid attack_order unit names", () => {
  const root = writeConfigWithTroopEffect({
    type: "attack_order",
    value: ["marksman", "invalid-unit", "lancer"],
    units: { applies_to: "lancer", applies_vs: "marksman" }
  });

  assert.throws(() => loadSimulatorConfigFromDir(root), /attack_order.*unsupported unit.*invalid-unit/i);
});

test("loadSimulatorConfig rejects effects targeting static buckets unless they are fully static", () => {
  const turnRoot = writeConfigWithTroopEffect({
    type: "passive.attack.up",
    value: 10
  });
  const durationRoot = writeConfigWithTroopEffect(
    {
      type: "passive.attack.up",
      value: 10,
      duration: { turns: { count: 1 } }
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
  const emptyDurationRoot = writeConfigWithTroopEffect(
    {
      type: "passive.attack.up",
      value: 10,
      duration: {}
    },
    { type: "battle_start" }
  );
  const probabilityRoot = writeConfigWithTroopEffect(
    {
      type: "passive.attack.up",
      value: 10
    },
    { type: "battle_start", probability: 50 }
  );
  const maxStackingRoot = writeConfigWithTroopEffect(
    {
      type: "passive.attack.up",
      value: 10,
      same_effect_stacking: "max"
    },
    { type: "battle_start" }
  );

  assert.throws(() => loadSimulatorConfigFromDir(turnRoot), /static bucket passive\.attack\.up.*battle_start/i);
  assert.throws(() => loadSimulatorConfigFromDir(durationRoot), /static bucket passive\.attack\.up.*duration/i);
  assert.throws(() => loadSimulatorConfigFromDir(emptyDurationRoot), /static bucket passive\.attack\.up.*duration/i);
  assert.throws(() => loadSimulatorConfigFromDir(evolvingRoot), /static bucket passive\.attack\.up.*value_evolution/i);
  assert.throws(() => loadSimulatorConfigFromDir(probabilityRoot), /static bucket passive\.attack\.up.*probability/i);
  assert.throws(() => loadSimulatorConfigFromDir(maxStackingRoot), /static bucket passive\.attack\.up.*cannot use max stacking/i);
});

test("loadSimulatorConfig rejects skill effects targeting input-derived static buckets", () => {
  const playerRoot = writeConfigWithTroopEffect(
    { type: "player.attack", value: 10 },
    { type: "battle_start" }
  );
  const troopsRoot = writeConfigWithTroopEffect(
    { type: "troops.baseAttack", value: 10 },
    { type: "battle_start" }
  );

  assert.throws(() => loadSimulatorConfigFromDir(playerRoot), /input-derived static bucket/i);
  assert.throws(() => loadSimulatorConfigFromDir(troopsRoot), /input-derived static bucket/i);
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

test("loadSimulatorConfig rejects stacking metadata on extra skill attacks", () => {
  const root = writeConfigWithTroopEffect({
    type: "extra_skill_attack",
    value: 100,
    same_effect_stacking: "max",
    units: { applies_to: "trigger.source", applies_vs: "trigger.target" },
    trigger_damage_jobs: [{ source: "use.source", target: "use.target" }]
  });

  assert.throws(() => loadSimulatorConfigFromDir(root), /extra_skill_attack does not support same_effect_stacking/i);
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

test("loadSimulatorConfig rejects per-job extra skill damage multipliers", () => {
  const root = writeConfigWithTroopEffect({
    type: "extra_skill_attack",
    value: 100,
    units: { applies_to: "trigger.source", applies_vs: "trigger.target" },
    trigger_damage_jobs: [{ source: "use.source", target: "use.target", multiplier: 50 }]
  });

  assert.throws(() => loadSimulatorConfigFromDir(root), /unknown trigger_damage_jobs key multiplier/i);
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

function writeConfigWithTroopEffect(effect: Record<string, unknown>, trigger: Record<string, unknown> = { type: "turn" }): string {
  const root = join(tmpdir(), `wos-simulator-config-trigger-jobs-${Date.now()}-${Math.random().toString(16).slice(2)}`);
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
