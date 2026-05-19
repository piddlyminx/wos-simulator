import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { UNIT_TYPES } from "./types.js";
import type { ConfigDiagnostics, EffectIntentDefinition, SimulatorConfig, SkillFile, TriggerDamageJobDefinition } from "./types.js";

const LEGACY_FIELDS = new Set(["legacy", "effect_op", "effect_type"]);
const KNOWN_EFFECT_TYPES = new Set([
  "lethality_up",
  "lethality_down",
  "attack_up",
  "attack_down",
  "damage_up",
  "damage_down",
  "crit_damage_up",
  "normal_damage_up",
  "normal_damage_down",
  "skill_damage_up",
  "skill_damage_down",
  "defense_up",
  "defense_down",
  "health_up",
  "health_down",
  "damage_taken_down",
  "damage_taken_up",
  "normal_defense_up",
  "normal_defense_down",
  "skill_defense_up",
  "skill_defense_down",
  "stat_bonus",
  "extra_skill_attack",
  "dodge",
  "no_attack",
  "attack_order"
]);

export function defaultConfigDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "config");
}

export function loadSimulatorConfig(options: { configDir?: string } = {}): SimulatorConfig {
  const configDir = resolve(options.configDir ?? defaultConfigDir());
  const diagnostics: ConfigDiagnostics = { legacyFields: [], effectTypes: {}, unsupportedEffects: [] };

  const troopStats = readJson(join(configDir, "troop_stats.json"), diagnostics) as SimulatorConfig["troopStats"];
  const heroGenerationStats = readJson(join(configDir, "hero_generation_stats.json"), diagnostics) as SimulatorConfig["heroGenerationStats"];
  const troopSkills = readJson(join(configDir, "troop_skills.json"), diagnostics) as SkillFile;
  const heroDir = join(configDir, "hero_definitions");
  const heroDefinitions: Record<string, SkillFile> = {};

  for (const file of readdirSync(heroDir).filter((name: string) => name.endsWith(".json")).sort()) {
    const fullPath = join(heroDir, file);
    const hero = readJson(fullPath, diagnostics) as SkillFile;
    const key = file.slice(0, -".json".length);
    heroDefinitions[key] = hero;
    if (hero.hero_generation && !heroGenerationStats[hero.hero_generation]) {
      diagnostics.unsupportedEffects.push({
        file: relative(process.cwd(), fullPath),
        skillId: "(hero_generation)",
        effectId: hero.hero_generation,
        type: "missing_hero_generation",
        reason: `Referenced hero_generation ${hero.hero_generation} is not defined`
      });
    }
  }

  collectEffectDiagnostics(troopSkills, join(configDir, "troop_skills.json"), diagnostics);
  for (const [name, hero] of Object.entries(heroDefinitions)) {
    collectEffectDiagnostics(hero, join(heroDir, `${name}.json`), diagnostics);
  }

  const heroAliasIndex = buildHeroAliasIndex(heroDefinitions);

  if (diagnostics.legacyFields.length > 0) {
    const first = diagnostics.legacyFields[0];
    throw new Error(`Legacy field found in v3 config: ${first.field} at ${first.file}:${first.path}`);
  }

  return { troopStats, heroGenerationStats, heroDefinitions, heroAliasIndex, troopSkills, diagnostics };
}

function readJson(path: string, diagnostics: ConfigDiagnostics): unknown {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  scanLegacyFields(parsed, relative(process.cwd(), path), "$", diagnostics);
  return parsed;
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
    for (const [effectId, effect] of Object.entries(skill.effects ?? {})) {
      const type = String((effect as { type?: unknown }).type ?? "");
      diagnostics.effectTypes[type] = (diagnostics.effectTypes[type] ?? 0) + 1;
      if (type === "extra_skill_attack") validateExtraSkillAttackEffect(effect as EffectIntentDefinition, file, skillId, effectId);
      if (!KNOWN_EFFECT_TYPES.has(type)) {
        diagnostics.unsupportedEffects.push({
          file: relative(process.cwd(), file),
          skillId,
          effectId,
          type,
          reason: "Effect type is not in the initial v3 classifier policy"
        });
      }
    }
  }
}

function validateExtraSkillAttackEffect(effect: EffectIntentDefinition, file: string, skillId: string, effectId: string): void {
  const path = `${relative(process.cwd(), file)}:${skillId}.${effectId}`;
  if (!Array.isArray(effect.trigger_damage_jobs) || effect.trigger_damage_jobs.length === 0) {
    throw new Error(`extra_skill_attack requires non-empty trigger_damage_jobs at ${path}`);
  }
  effect.trigger_damage_jobs.forEach((job, index) => {
    validateTriggerDamageJobSelector(job.source, "source", path, index);
    validateTriggerDamageJobSelector(job.target, "target", path, index);
    if (job.target === "activation.target" && effect.units?.applies_vs === "any") {
      throw new Error(`trigger_damage_jobs target activation.target requires a concrete applies_vs, not any, at ${path}.trigger_damage_jobs[${index}]`);
    }
    if (job.multiplier !== undefined && typeof job.multiplier !== "number") {
      throw new Error(`trigger_damage_jobs multiplier must be a number at ${path}.trigger_damage_jobs[${index}]`);
    }
  });
}

function validateTriggerDamageJobSelector(
  selector: TriggerDamageJobDefinition["source"],
  role: "source" | "target",
  path: string,
  jobIndex: number
): void {
  if (selector === undefined || isAllowedTriggerDamageJobSelector(selector)) return;
  throw new Error(`invalid trigger_damage_jobs ${role} selector ${JSON.stringify(selector)} at ${path}.trigger_damage_jobs[${jobIndex}]`);
}

function isAllowedTriggerDamageJobSelector(selector: TriggerDamageJobDefinition["source"]): boolean {
  const supported = new Set(["use.source", "use.target", "activation.source", "activation.target", "enemy.living", "self.living"]);
  if (typeof selector === "string") return supported.has(selector) || (UNIT_TYPES as string[]).includes(selector);
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

export function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
