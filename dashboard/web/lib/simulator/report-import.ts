import { loadSimulatorConfig } from "@simulator/config-default";
import { STATIC_BUCKET_INDEX } from "@simulator/damageBuckets";
import { prepareBattle } from "@simulator/prepare";
import { buildStaticDamageBucketFactors } from "@simulator/staticDamageProfile";
import type { SimulatorConfig } from "@simulator/types";
import type { TroopCategory } from "@/lib/heroes-catalogue";
import type { ReportImportFighter, ReportImportRequest, SimulateRequestPayload, SimulateSidePayload } from "@/lib/simulate-run";
import { toBattleInput } from "./adapters";

const CATEGORIES = ["infantry", "lancer", "marksman"] as const;
const STAT_KEYS = { infantry: "inf", lancer: "lanc", marksman: "mark" } as const;
const STATS = ["attack", "defense", "lethality", "health"] as const;
const NEUTRAL_STATS: SimulateSidePayload["stats"] = {
  inf: [0, 0, 0, 0], lanc: [0, 0, 0, 0], mark: [0, 0, 0, 0],
};

/** Normalize exported report data without changing the original source evidence. */
export function normalizeReportImport(
  imported: ReportImportRequest,
  config: SimulatorConfig = loadSimulatorConfig(),
): SimulateRequestPayload {
  const warnings = [...imported.source_report.warnings];
  const request: SimulateRequestPayload = {
    attacker: simulationSide(imported.report_import.attacker, config, "attacker", warnings),
    defender: simulationSide(imported.report_import.defender, config, "defender", warnings),
    replicates: imported.replicates,
    rally_mode: imported.rally_mode,
  };

  // Game totals already include contextual stat bonuses. Remove modeled passive
  // multipliers only for observed usable totals; missing bonuses remain neutral.
  try {
    const factorRequest = {
      ...request,
      attacker: { ...request.attacker, stats: NEUTRAL_STATS },
      defender: { ...request.defender, stats: NEUTRAL_STATS },
    };
    const compiled = prepareBattle(toBattleInput(factorRequest, "dashboard:0"), config);
    const factors = buildStaticDamageBucketFactors(compiled.fighters, compiled.preBattleEffects);
    for (const side of ["attacker", "defender"] as const) {
      for (const category of CATEGORIES) {
        const tuple = request[side].stats[STAT_KEYS[category]];
        STATS.forEach((stat, index) => {
          const observed = imported.report_import[side].stats?.[category]?.[stat];
          if (typeof observed !== "number" || !Number.isFinite(observed) || observed <= -100) return;
          const up = factors[side][category][STATIC_BUCKET_INDEX[`passive.${stat}.up`]];
          const down = factors[side][category][STATIC_BUCKET_INDEX[`passive.${stat}.down`]];
          const value = (100 + tuple[index]) * down / up - 100;
          if (!Number.isFinite(value) || value <= -100) {
            tuple[index] = 0;
            warnings.push(`${side} ${category} ${stat}: could not reconstruct a usable base stat; using neutral 0% bonus.`);
          } else tuple[index] = value;
        });
      }
    }
  } catch (error) {
    warnings.push(`Could not normalize reported stat bonuses: ${error instanceof Error ? error.message : String(error)}. Using recovered bonuses without removing modeled passive effects.`);
  }
  request.source_report = { ...imported.source_report, warnings: [...new Set(warnings)] };
  return request;
}

function simulationSide(fighter: ReportImportFighter, config: SimulatorConfig, label: string, warnings: string[]): SimulateSidePayload {
  const side: SimulateSidePayload = {
    troops: { infantry: 0, lancer: 0, marksman: 0 },
    troop_types: { infantry: "infantry_t1", lancer: "lancer_t1", marksman: "marksman_t1" },
    troop_composition: {},
    heroes: {
      infantry: { name: null, skills: [0, 0, 0, 0] },
      lancer: { name: null, skills: [0, 0, 0, 0] },
      marksman: { name: null, skills: [0, 0, 0, 0] },
    },
    joiners: [],
    stat_profile_name: fighter.name ?? null,
    stats: { inf: [0, 0, 0, 0], lanc: [0, 0, 0, 0], mark: [0, 0, 0, 0] },
  };
  for (const [key, count] of Object.entries(fighter.troops ?? {})) {
    const troop = config.troopStats[key];
    if (!troop || !CATEGORIES.includes(troop.type) || !Number.isSafeInteger(count) || count < 0) {
      warnings.push(`${label}: omitted troop line ${key} (${count}); ${troop ? "unusable troop type or count" : "not supported by the simulator"}.`);
      continue;
    }
    if (!count) continue;
    if (!side.troops[troop.type]) side.troop_types[troop.type] = key;
    side.troops[troop.type] += count;
    side.troop_composition![key] = count;
  }
  for (const [name, levels] of Object.entries(fighter.heroes ?? {})) {
    const definition = heroDefinition(name, config);
    if (!definition) {
      warnings.push(`${label}: omitted main hero ${name}; not supported by the simulator. Reported stat bonuses remain included, but this hero's simulated skills are absent.`);
      continue;
    }
    const category = definition.troop_type === "marksmen" ? "marksman" : definition.troop_type as TroopCategory;
    if (!CATEGORIES.includes(category) || side.heroes[category].name) {
      warnings.push(`${label}: omitted main hero ${name}; ${CATEGORIES.includes(category) ? `another hero already occupies ${category}` : "unknown troop category"}.`);
      continue;
    }
    const skills = [0, 0, 0, 0] as [number, number, number, number];
    for (let index = 0; index < skills.length; index++) {
      const level = levels[`skill_${index + 1}`];
      if (level === undefined || level === 0) continue;
      if (!Number.isInteger(level) || level < 0 || level > 5 || index >= Object.keys(definition.skills ?? {}).length) {
        warnings.push(`${label} ${name}: omitted skill ${index + 1} with level ${level}; not representable by the simulator.`);
      } else skills[index] = level;
    }
    side.heroes[category] = { name: definition.name ?? name, skills };
  }
  if (Array.isArray(fighter.joiner_heroes)) {
    for (const [index, joiner] of fighter.joiner_heroes.entries()) {
      if (index >= 4) {
        warnings.push(`${label}: omitted joiner ${joiner.name}; outside the first four contributing positions.`);
        continue;
      }
      const definition = heroDefinition(joiner.name, config);
      const level = joiner.levels?.skill_1;
      if (!definition || typeof level !== "number" || !Number.isInteger(level) || level < 1 || level > 5) {
        warnings.push(`${label}: omitted joiner ${joiner.name}; ${definition ? `unusable first skill level ${level}` : "not supported by the simulator"}.`);
        continue;
      }
      side.joiners.push({ name: definition.name ?? joiner.name, skill_1: level });
    }
  }
  for (const category of CATEGORIES) {
    const stats = fighter.stats?.[category];
    side.stats[STAT_KEYS[category]] = STATS.map(stat => {
      const value = stats?.[stat];
      if (typeof value === "number" && Number.isFinite(value) && value > -100) return value;
      warnings.push(`${label} ${category} ${stat}: no usable reported stat; using neutral 0% bonus.`);
      return 0;
    }) as [number, number, number, number];
  }
  if (CATEGORIES.every(category => side.troops[category] === 0)) {
    throw new Error(`${label}: no usable troops could be extracted; simulation requires at least one troop on each side.`);
  }
  return side;
}

function heroDefinition(name: string, config: SimulatorConfig) {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const indexed = config.heroAliasIndex?.[key];
  return config.heroDefinitions[name] ?? (indexed ? config.heroDefinitions[indexed] : undefined)
    ?? Object.entries(config.heroDefinitions).find(([id, hero]) =>
      [id, hero.name ?? id].some(value => value.toLowerCase().replace(/[^a-z0-9]/g, "") === key))?.[1];
}
