import troopStatsJson from "../config/troop_stats.json" with { type: "json" };
import heroGenerationStatsJson from "../config/hero_generation_stats.json" with { type: "json" };
import troopSkillsJson from "../config/troop_skills.json" with { type: "json" };
import Ahmose from "../config/hero_definitions/Ahmose.json" with { type: "json" };
import Alonso from "../config/hero_definitions/Alonso.json" with { type: "json" };
import Bahiti from "../config/hero_definitions/Bahiti.json" with { type: "json" };
import Bradley from "../config/hero_definitions/Bradley.json" with { type: "json" };
import Edith from "../config/hero_definitions/Edith.json" with { type: "json" };
import Flint from "../config/hero_definitions/Flint.json" with { type: "json" };
import Gatot from "../config/hero_definitions/Gatot.json" with { type: "json" };
import Gordon from "../config/hero_definitions/Gordon.json" with { type: "json" };
import Greg from "../config/hero_definitions/Greg.json" with { type: "json" };
import Gwen from "../config/hero_definitions/Gwen.json" with { type: "json" };
import Hector from "../config/hero_definitions/Hector.json" with { type: "json" };
import Hendrik from "../config/hero_definitions/Hendrik.json" with { type: "json" };
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
import Sonya from "../config/hero_definitions/Sonya.json" with { type: "json" };
import Wayne from "../config/hero_definitions/Wayne.json" with { type: "json" };
import WuMing from "../config/hero_definitions/WuMing.json" with { type: "json" };
import Zinman from "../config/hero_definitions/Zinman.json" with { type: "json" };

import { UNIT_TYPES } from "./types";
import type { ConfigDiagnostics, EffectIntentDefinition, SimulatorConfig, SkillFile, TriggerDamageJobDefinition } from "./types";
import {
  DYNAMIC_EFFECT_BUCKETS,
  STATIC_EFFECT_BUCKETS,
  dynamicBucketDefinition,
  isPassiveBucket,
  staticBucketDefinition
} from "./damageBuckets";
import { normalizeUnitType } from "./normalize";

const KNOWN_EFFECT_TYPES = new Set([
  ...DYNAMIC_EFFECT_BUCKETS,
  ...STATIC_EFFECT_BUCKETS,
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
  Gatot,
  Gordon,
  Greg,
  Gwen,
  Hector,
  Hendrik,
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
  Sonya,
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
    throw new Error(`Legacy field found in simulator config: ${first.field} at ${first.file}:${first.path}`);
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
    if (isLegacyConfigField(key)) diagnostics.legacyFields.push({ file, path, field: key });
    scanLegacyFields(child, file, `${path}.${key}`, diagnostics);
  }
}

function isLegacyConfigField(key: string): boolean {
  if (key === "legacy") return true;
  if (!key.startsWith("effect_")) return false;
  const suffix = key.slice("effect_".length);
  return suffix === "op" || suffix === "type";
}

function collectEffectDiagnostics(skillFile: SkillFile, file: string, diagnostics: ConfigDiagnostics): void {
  for (const [skillId, skill] of Object.entries(skillFile.skills ?? {})) {
    validateTriggerDefinition(skill.trigger, file, skillId);
    if (skill.trigger.type === "pre_battle") validatePreBattleSkill(skill, file, skillId);
    for (const [effectId, effect] of Object.entries(skill.effects ?? {})) {
      const type = String((effect as { type?: unknown }).type ?? "");
      diagnostics.effectTypes[type] = (diagnostics.effectTypes[type] ?? 0) + 1;
      collectAmbiguousTurnTriggerSelectorDiagnostics(skill.trigger, effect as EffectIntentDefinition, file, skillId, effectId, diagnostics);
      validateBattleStartEffectSelectors(skill.trigger, effect as EffectIntentDefinition, file, skillId, effectId);
      validateNativeEffectUnits(effect as EffectIntentDefinition, file, skillId, effectId);
      validateNativeEffectValue(effect as EffectIntentDefinition, file, skillId, effectId);
      validateEffectValueFormula(skill.trigger, effect as EffectIntentDefinition, file, skillId, effectId);
      if (type === "attack_order") validateAttackOrderEffect(effect as EffectIntentDefinition, file, skillId, effectId);
      validateNativeEffectDuration(effect as EffectIntentDefinition, file, skillId, effectId);
      validateStaticBucketEffect(skill.trigger, effect as EffectIntentDefinition, file, skillId, effectId);
      if (type === "extra_skill_attack") validateExtraSkillAttackEffect(effect as EffectIntentDefinition, file, skillId, effectId);
      if (!KNOWN_EFFECT_TYPES.has(type)) {
        diagnostics.unsupportedEffects.push({
          file,
          skillId,
          effectId,
          type,
          reason: "Effect type is not supported by the native simulator"
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
  if (trigger.first !== undefined && (!Number.isFinite(Number(trigger.first)) || Number(trigger.first) < 1)) {
    throw new Error(`trigger.first must be a positive number at ${file}:${skillId}.trigger.first`);
  }
  if (trigger.first !== undefined && trigger.every === undefined) {
    throw new Error(`trigger.first requires trigger.every at ${file}:${skillId}.trigger`);
  }
}

function isTriggerRelativeUnitSelector(selector: unknown): selector is string {
  return selector === "trigger" || selector === "trigger.source" || selector === "target" || selector === "trigger.target";
}

function validateBattleStartEffectSelectors(
  trigger: SkillFile["skills"][string]["trigger"],
  effect: EffectIntentDefinition,
  file: string,
  skillId: string,
  effectId: string
): void {
  if (trigger.type !== "battle_start" && trigger.type !== "pre_battle") return;
  for (const field of ["applies_to", "applies_vs"] as const) {
    const selector = effect.units?.[field];
    if (!isTriggerRelativeUnitSelector(selector)) continue;
    throw new Error(
      `${trigger.type} effect cannot use trigger-relative units.${field} selector ${JSON.stringify(selector)} at ${file}:${skillId}.${effectId}; use a concrete selector such as self.any`
    );
  }
}

// The pre_battle phase feeds the static damage profile before any runtime exists, so by
// definition it is chance-free and carries only static passive-bucket effects.
function validatePreBattleSkill(skill: SkillFile["skills"][string], file: string, skillId: string): void {
  const path = `${file}:${skillId}`;
  if (skill.trigger.probability !== undefined) {
    throw new Error(`pre_battle skill cannot define trigger probability at ${path}; pre_battle is chance-free by definition`);
  }
  for (const [effectId, effect] of Object.entries(skill.effects ?? {})) {
    const type = String((effect as { type?: unknown }).type ?? "");
    if (!isPassiveBucket(type)) {
      throw new Error(
        `pre_battle skill may only contain static passive-bucket effects; effect ${type} at ${path}.${effectId} must use a runtime trigger such as battle_start`
      );
    }
  }
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

// Static buckets are aggregated once per battle into the static damage profile before any
// runtime exists, so skill effects that feed them live in the pre_battle phase and must be
// deterministic, immutable, and permanent. Static buckets outside the passive family
// (troops/player) are input-derived and cannot be produced by a skill at all.
function validateStaticBucketEffect(
  trigger: SkillFile["skills"][string]["trigger"],
  effect: EffectIntentDefinition,
  file: string,
  skillId: string,
  effectId: string
): void {
  const definition = staticBucketDefinition(effect.type);
  if (!definition) return;

  const path = `${file}:${skillId}.${effectId}`;
  if (!isPassiveBucket(effect.type)) {
    throw new Error(`effect type ${effect.type} targets an input-derived static bucket and cannot be defined by a skill at ${path}`);
  }
  if (trigger.type !== "pre_battle") {
    throw new Error(`effect targeting static bucket ${effect.type} must use a pre_battle trigger at ${path}`);
  }
  if (effect.value_evolution !== undefined) {
    throw new Error(`effect targeting static bucket ${effect.type} cannot define value_evolution at ${path}`);
  }
  if (effect.duration !== undefined) {
    throw new Error(`effect targeting static bucket ${effect.type} cannot define duration at ${path}`);
  }
  if (effect.same_effect_stacking === "max") {
    throw new Error(`effect targeting static bucket ${effect.type} cannot use max stacking at ${path}; passive effects are additive`);
  }
}

function validateNativeEffectValue(effect: EffectIntentDefinition, file: string, skillId: string, effectId: string): void {
  const definition = dynamicBucketDefinition(effect.type) ?? staticBucketDefinition(effect.type);
  if (definition?.effectBucket !== true) return;
  const values = Array.isArray(effect.value) ? effect.value : [effect.value];
  for (const value of values) {
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`native bucket effect ${effect.type} value must be a finite number at ${file}:${skillId}.${effectId}`);
    }
    if (value < 0) {
      throw new Error(`negative native bucket effect ${effect.type} value is not supported at ${file}:${skillId}.${effectId}; use positive magnitudes`);
    }
  }
}

function validateEffectValueFormula(
  trigger: SkillFile["skills"][string]["trigger"],
  effect: EffectIntentDefinition,
  file: string,
  skillId: string,
  effectId: string
): void {
  if (effect.value_formula === undefined) return;
  const path = `${file}:${skillId}.${effectId}.value_formula`;
  if (trigger.type !== "attack") {
    throw new Error(`effect value_formula requires an attack trigger at ${path}`);
  }
  if (effect.value_evolution !== undefined) {
    throw new Error(`effect cannot combine value_formula with value_evolution at ${path}`);
  }
  if (effect.value === undefined) {
    throw new Error(`effect value_formula requires a numeric percentage coefficient in value at ${path}`);
  }
  const formula = effect.value_formula as unknown;
  if (!formula || typeof formula !== "object" || Array.isArray(formula)) {
    throw new Error(`effect value_formula must be an object at ${path}`);
  }
  const record = formula as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "type" && key !== "source") throw new Error(`unknown value_formula key ${key} at ${path}`);
  }
  if (record.type !== "percent_of") {
    throw new Error(`effect value_formula type must be "percent_of" at ${path}`);
  }
  if (!new Set(["trigger.normal_kills", "trigger.skill_kills", "trigger.total_kills"]).has(String(record.source))) {
    throw new Error(`invalid value_formula source ${JSON.stringify(record.source)} at ${path}`);
  }
}

function validateAttackOrderEffect(effect: EffectIntentDefinition, file: string, skillId: string, effectId: string): void {
  const path = `${file}:${skillId}.${effectId}`;
  if (!Array.isArray(effect.value) || effect.value.length === 0) {
    throw new Error(`attack_order value must be a non-empty unit array at ${path}`);
  }
  for (const value of effect.value) {
    if (typeof value !== "string") {
      throw new Error(`attack_order value must contain only unit names at ${path}`);
    }
    try {
      normalizeUnitType(value);
    } catch {
      throw new Error(`attack_order value contains unsupported unit ${JSON.stringify(value)} at ${path}`);
    }
  }
}

function validateNativeEffectDuration(effect: EffectIntentDefinition, file: string, skillId: string, effectId: string): void {
  if (effect.duration === undefined) return;
  const path = `${file}:${skillId}.${effectId}.duration`;
  const duration = effect.duration as Record<string, unknown>;
  for (const key of Object.keys(duration)) {
    if (key !== "turns" && key !== "attacks") {
      throw new Error(`native effect duration key ${key} is not supported at ${path}; use turns and/or attacks`);
    }
  }
  for (const key of ["turns", "attacks"] as const) {
    const value = duration[key];
    if (value === undefined) continue;
    validateNativeEffectDurationAxis(value, `${path}.${key}`);
  }
}

function validateNativeEffectDurationAxis(value: unknown, path: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`native effect duration axis must be an object at ${path}`);
  }
  const axis = value as Record<string, unknown>;
  for (const key of Object.keys(axis)) {
    if (key !== "count" && key !== "delay") {
      throw new Error(`native effect duration axis key ${key} is not supported at ${path}; use count and/or delay`);
    }
  }
  if (axis.count === undefined && axis.delay === undefined) {
    throw new Error(`native effect duration axis must define count or delay at ${path}`);
  }
  if (axis.count !== undefined) validateIntegerRange(axis.count, 1, `${path}.count`);
  if (axis.delay !== undefined) validateIntegerRange(axis.delay, 0, `${path}.delay`);
}

function validateIntegerRange(value: unknown, min: number, path: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw new Error(`native effect duration ${path} must be an integer >= ${min}`);
  }
}

function validateExtraSkillAttackEffect(effect: EffectIntentDefinition, file: string, skillId: string, effectId: string): void {
  const path = `${file}:${skillId}.${effectId}`;
  if (effect.same_effect_stacking !== undefined) {
    throw new Error(`extra_skill_attack does not support same_effect_stacking at ${path}; every applicable effect emits all configured damage jobs`);
  }
  if (!Array.isArray(effect.trigger_damage_jobs) || effect.trigger_damage_jobs.length === 0) {
    throw new Error(`extra_skill_attack requires non-empty trigger_damage_jobs at ${path}`);
  }
  effect.trigger_damage_jobs.forEach((job, index) => {
    validateTriggerDamageJobShape(job, path, index);
    validateTriggerDamageJobSelector(job.source, "source", path, index);
    validateTriggerDamageJobSelector(job.target, "target", path, index);
    if (job.target === "effect.applies_vs" && !isEffectAppliesVsConcrete(effect.units?.applies_vs)) {
      throw new Error(
        `trigger_damage_jobs target effect.applies_vs requires a concrete applies_vs, not ${JSON.stringify(effect.units?.applies_vs)}, at ${path}.trigger_damage_jobs[${index}]`
      );
    }
  });
}

function validateTriggerDamageJobShape(job: unknown, path: string, jobIndex: number): asserts job is TriggerDamageJobDefinition {
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    throw new Error(`trigger_damage_jobs entry must be an object at ${path}.trigger_damage_jobs[${jobIndex}]`);
  }
  const allowedKeys = new Set(["source", "target"]);
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

function buildHeroAliasIndex(heroDefinitions: Record<string, SkillFile>): Record<string, string> {
  const index: Record<string, string> = {};
  for (const [key, definition] of Object.entries(heroDefinitions)) {
    addHeroAlias(index, key, key);
    if (definition.name) addHeroAlias(index, definition.name, key);
    for (const alias of definition.aliases ?? []) addHeroAlias(index, alias, key);
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
