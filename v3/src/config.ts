import troopStatsJson from "../config/troop_stats.json" with { type: "json" };
import heroGenerationStatsJson from "../config/hero_generation_stats.json" with { type: "json" };
import troopSkillsJson from "../config/troop_skills.json" with { type: "json" };
import Ahmose from "../config/hero_definitions/Ahmose.json" with { type: "json" };
import Alonso from "../config/hero_definitions/Alonso.json" with { type: "json" };
import Bahiti from "../config/hero_definitions/Bahiti.json" with { type: "json" };
import Bradley from "../config/hero_definitions/Bradley.json" with { type: "json" };
import Edith from "../config/hero_definitions/Edith.json" with { type: "json" };
import Flint from "../config/hero_definitions/Flint.json" with { type: "json" };
import Gordon from "../config/hero_definitions/Gordon.json" with { type: "json" };
import Greg from "../config/hero_definitions/Greg.json" with { type: "json" };
import Gwen from "../config/hero_definitions/Gwen.json" with { type: "json" };
import Hector from "../config/hero_definitions/Hector.json" with { type: "json" };
import Jasser from "../config/hero_definitions/Jasser.json" with { type: "json" };
import Jeronimo from "../config/hero_definitions/Jeronimo.json" with { type: "json" };
import Jessie from "../config/hero_definitions/Jessie.json" with { type: "json" };
import Ling from "../config/hero_definitions/Ling.json" with { type: "json" };
import Logan from "../config/hero_definitions/Logan.json" with { type: "json" };
import Lumak from "../config/hero_definitions/Lumak.json" with { type: "json" };
import Lynn from "../config/hero_definitions/Lynn.json" with { type: "json" };
import Mia from "../config/hero_definitions/Mia.json" with { type: "json" };
import Molly from "../config/hero_definitions/Molly.json" with { type: "json" };
import Natalia from "../config/hero_definitions/Natalia.json" with { type: "json" };
import Norah from "../config/hero_definitions/Norah.json" with { type: "json" };
import Patrick from "../config/hero_definitions/Patrick.json" with { type: "json" };
import Philly from "../config/hero_definitions/Philly.json" with { type: "json" };
import Reina from "../config/hero_definitions/Reina.json" with { type: "json" };
import Renee from "../config/hero_definitions/Renee.json" with { type: "json" };
import SeoYoon from "../config/hero_definitions/Seo-yoon.json" with { type: "json" };
import Sergey from "../config/hero_definitions/Sergey.json" with { type: "json" };
import Wayne from "../config/hero_definitions/Wayne.json" with { type: "json" };
import WuMing from "../config/hero_definitions/WuMing.json" with { type: "json" };
import Zinman from "../config/hero_definitions/Zinman.json" with { type: "json" };

import { UNIT_TYPES } from "./types.js";
import type { ConfigDiagnostics, EffectIntentDefinition, SimulatorConfig, SkillFile, TriggerDamageJobDefinition } from "./types.js";
import { ATOMIC_BUCKETS } from "./damageBuckets.js";

const LEGACY_FIELDS = new Set(["legacy", "effect_op", "effect_type"]);
const KNOWN_EFFECT_TYPES = new Set([
  ...ATOMIC_BUCKETS.filter((bucket) => bucket.startsWith("active.") || bucket.startsWith("passive.") || bucket.startsWith("type.")),
  "extra_skill_attack",
  "dodge",
  "no_attack",
  "attack_order"
]);

const DEFAULT_HERO_DEFINITIONS = {
  Ahmose,
  Alonso,
  Bahiti,
  Bradley,
  Edith,
  Flint,
  Gordon,
  Greg,
  Gwen,
  Hector,
  Jasser,
  Jeronimo,
  Jessie,
  Ling,
  Logan,
  Lumak,
  Lynn,
  Mia,
  Molly,
  Natalia,
  Norah,
  Patrick,
  Philly,
  Reina,
  Renee,
  "Seo-yoon": SeoYoon,
  Sergey,
  Wayne,
  WuMing,
  Zinman
} as unknown as Record<string, SkillFile>;

export interface RawSimulatorConfig {
  troopStats: SimulatorConfig["troopStats"];
  heroGenerationStats: SimulatorConfig["heroGenerationStats"];
  troopSkills: SkillFile;
  heroDefinitions: Record<string, SkillFile>;
  fileLabel?: (kind: "troop_stats" | "hero_generation_stats" | "troop_skills" | "hero_definition", key?: string) => string;
}

export function loadSimulatorConfig(): SimulatorConfig {
  return buildSimulatorConfig({
    troopStats: troopStatsJson as SimulatorConfig["troopStats"],
    heroGenerationStats: heroGenerationStatsJson as SimulatorConfig["heroGenerationStats"],
    troopSkills: troopSkillsJson as SkillFile,
    heroDefinitions: DEFAULT_HERO_DEFINITIONS
  });
}

export function buildSimulatorConfig(raw: RawSimulatorConfig): SimulatorConfig {
  const diagnostics: ConfigDiagnostics = {
    legacyFields: [],
    effectTypes: {},
    unsupportedEffects: [],
    ambiguousTurnTriggerSelectors: []
  };

  scanLegacyFields(raw.troopStats, raw.fileLabel?.("troop_stats") ?? "config/troop_stats.json", "$", diagnostics);
  scanLegacyFields(raw.heroGenerationStats, raw.fileLabel?.("hero_generation_stats") ?? "config/hero_generation_stats.json", "$", diagnostics);
  scanLegacyFields(raw.troopSkills, raw.fileLabel?.("troop_skills") ?? "config/troop_skills.json", "$", diagnostics);

  for (const [name, hero] of Object.entries(raw.heroDefinitions)) {
    const file = raw.fileLabel?.("hero_definition", name) ?? `config/hero_definitions/${name}.json`;
    scanLegacyFields(hero, file, "$", diagnostics);
    if (hero.hero_generation && !raw.heroGenerationStats[hero.hero_generation]) {
      diagnostics.unsupportedEffects.push({
        file,
        skillId: "(hero_generation)",
        effectId: hero.hero_generation,
        type: "missing_hero_generation",
        reason: `Referenced hero_generation ${hero.hero_generation} is not defined`
      });
    }
  }

  collectEffectDiagnostics(raw.troopSkills, raw.fileLabel?.("troop_skills") ?? "config/troop_skills.json", diagnostics);
  for (const [name, hero] of Object.entries(raw.heroDefinitions)) {
    collectEffectDiagnostics(hero, raw.fileLabel?.("hero_definition", name) ?? `config/hero_definitions/${name}.json`, diagnostics);
  }

  const heroAliasIndex = buildHeroAliasIndex(raw.heroDefinitions);

  if (diagnostics.legacyFields.length > 0) {
    const first = diagnostics.legacyFields[0];
    throw new Error(`Legacy field found in v3 config: ${first.field} at ${first.file}:${first.path}`);
  }

  return {
    troopStats: raw.troopStats,
    heroGenerationStats: raw.heroGenerationStats,
    heroDefinitions: raw.heroDefinitions,
    heroAliasIndex,
    troopSkills: raw.troopSkills,
    diagnostics
  };
}

function scanLegacyFields(value: unknown, file: string, path: string, diagnostics: ConfigDiagnostics): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanLegacyFields(entry, file, `${path}[${index}]`, diagnostics));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (LEGACY_FIELDS.has(key)) diagnostics.legacyFields.push({ file, path, field: key });
    scanLegacyFields(child, file, `${path}.${key}`, diagnostics);
  }
}

function collectEffectDiagnostics(skillFile: SkillFile, file: string, diagnostics: ConfigDiagnostics): void {
  for (const [skillId, skill] of Object.entries(skillFile.skills ?? {})) {
    validateTriggerDefinition(skill.trigger, file, skillId);
    for (const [effectId, effect] of Object.entries(skill.effects ?? {})) {
      const type = String((effect as { type?: unknown }).type ?? "");
      diagnostics.effectTypes[type] = (diagnostics.effectTypes[type] ?? 0) + 1;
      collectAmbiguousTurnTriggerSelectorDiagnostics(skill.trigger, effect as EffectIntentDefinition, file, skillId, effectId, diagnostics);
      validateNativeEffectUnits(effect as EffectIntentDefinition, file, skillId, effectId);
      if (type === "extra_skill_attack") validateExtraSkillAttackEffect(effect as EffectIntentDefinition, file, skillId, effectId);
      if (!KNOWN_EFFECT_TYPES.has(type)) {
        diagnostics.unsupportedEffects.push({
          file,
          skillId,
          effectId,
          type,
          reason: "Effect type is not in the initial v3 classifier policy"
        });
      }
    }
  }
}

function collectAmbiguousTurnTriggerSelectorDiagnostics(
  trigger: SkillFile["skills"][string]["trigger"],
  effect: EffectIntentDefinition,
  file: string,
  skillId: string,
  effectId: string,
  diagnostics: ConfigDiagnostics
): void {
  if (trigger.type !== "turn" || trigger.source !== undefined) return;
  for (const selector of [effect.units?.applies_to, effect.units?.applies_vs]) {
    if (!isTriggerRelativeUnitSelector(selector)) continue;
    diagnostics.ambiguousTurnTriggerSelectors.push({
      file,
      skillId,
      effectId,
      selector,
      reason: "Turn trigger has no concrete attack intent; trigger-relative unit selectors fall back to all units"
    });
  }
}

function validateTriggerDefinition(trigger: SkillFile["skills"][string]["trigger"], file: string, skillId: string): void {
  const legacyUnits = (trigger as unknown as Record<string, unknown>).units;
  if (legacyUnits !== undefined) {
    throw new Error(`legacy trigger units filters are not supported at ${file}:${skillId}.trigger.units; use trigger.source and trigger.target`);
  }
}

function isTriggerRelativeUnitSelector(selector: unknown): selector is string {
  return selector === "trigger" || selector === "trigger.source" || selector === "target" || selector === "trigger.target";
}

function validateNativeEffectUnits(effect: EffectIntentDefinition, file: string, skillId: string, effectId: string): void {
  const path = `${file}:${skillId}.${effectId}`;
  if (effect.units && "side" in effect.units) {
    throw new Error(`native effect units.side is not supported at ${path}; use relation-qualified applies_to selectors such as enemy.any or trigger.target`);
  }
  if (effect.units?.applies_vs !== "all") return;
  throw new Error(
    `native effect units.applies_vs cannot be "all" at ${path}; use "any" for an unrestricted usage gate or trigger_damage_jobs target selectors for multi-target damage`
  );
}

function validateExtraSkillAttackEffect(effect: EffectIntentDefinition, file: string, skillId: string, effectId: string): void {
  const path = `${file}:${skillId}.${effectId}`;
  if (!Array.isArray(effect.trigger_damage_jobs) || effect.trigger_damage_jobs.length === 0) {
    throw new Error(`extra_skill_attack requires non-empty trigger_damage_jobs at ${path}`);
  }
  effect.trigger_damage_jobs.forEach((job, index) => {
    validateTriggerDamageJobShape(job, path, index);
    validateTriggerDamageJobSelector(job.source, "source", path, index);
    validateTriggerDamageJobSelector(job.target, "target", path, index);
    if (job.target === "activation.target" && !isActivationConcreteAppliesVs(effect.units?.applies_vs)) {
      throw new Error(
        `trigger_damage_jobs target activation.target requires a concrete applies_vs, not ${JSON.stringify(effect.units?.applies_vs)}, at ${path}.trigger_damage_jobs[${index}]`
      );
    }
    if (job.multiplier !== undefined && typeof job.multiplier !== "number") {
      throw new Error(`trigger_damage_jobs multiplier must be a number at ${path}.trigger_damage_jobs[${index}]`);
    }
  });
}

function validateTriggerDamageJobShape(job: unknown, path: string, jobIndex: number): asserts job is TriggerDamageJobDefinition {
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    throw new Error(`trigger_damage_jobs entry must be an object at ${path}.trigger_damage_jobs[${jobIndex}]`);
  }
  const allowedKeys = new Set(["source", "target", "multiplier"]);
  for (const key of Object.keys(job)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`unknown trigger_damage_jobs key ${key} at ${path}.trigger_damage_jobs[${jobIndex}]`);
    }
  }
  const record = job as Record<string, unknown>;
  if (record.source === undefined) {
    throw new Error(`trigger_damage_jobs entry requires source at ${path}.trigger_damage_jobs[${jobIndex}]`);
  }
  if (record.target === undefined) {
    throw new Error(`trigger_damage_jobs entry requires target at ${path}.trigger_damage_jobs[${jobIndex}]`);
  }
}

function validateTriggerDamageJobSelector(
  selector: TriggerDamageJobDefinition["source"],
  role: "source" | "target",
  path: string,
  jobIndex: number
): void {
  if (isAllowedTriggerDamageJobSelector(selector)) return;
  throw new Error(`invalid trigger_damage_jobs ${role} selector ${JSON.stringify(selector)} at ${path}.trigger_damage_jobs[${jobIndex}]`);
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

function buildHeroAliasIndex(heroDefinitions: Record<string, SkillFile>): Record<string, string> {
  const index: Record<string, string> = {};
  for (const [key, definition] of Object.entries(heroDefinitions)) {
    addHeroAlias(index, key, key);
    if (definition.name) addHeroAlias(index, definition.name, key);
  }
  return index;
}

function addHeroAlias(index: Record<string, string>, alias: string, heroKey: string): void {
  const normalized = normalizeHeroAlias(alias);
  if (!normalized) return;
  const existing = index[normalized];
  if (existing && existing !== heroKey) {
    throw new Error(`Duplicate hero alias ${normalized} resolves to both ${existing} and ${heroKey}`);
  }
  index[normalized] = heroKey;
}

function normalizeHeroAlias(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
