import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { ConfigDiagnostics, SimulatorConfig, SkillFile } from "./types.js";

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

  if (diagnostics.legacyFields.length > 0) {
    const first = diagnostics.legacyFields[0];
    throw new Error(`Legacy field found in v3 config: ${first.field} at ${first.file}:${first.path}`);
  }

  return { troopStats, heroGenerationStats, heroDefinitions, troopSkills, diagnostics };
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

export function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
