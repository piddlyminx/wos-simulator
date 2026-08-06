import heroGenerationStatsJson from "../config/hero_generation_stats.json" with { type: "json" };
import troopSkillsJson from "../config/troop_skills.json" with { type: "json" };

import { buildSimulatorConfig } from "./config";
import type { SimulatorConfig, SkillFile } from "./types";

const heroDefinitionModules = import.meta.webpackContext(
  "../config/hero_definitions",
  {
    recursive: false,
    regExp: /\.json$/,
    mode: "sync",
  },
);

function moduleDefault(value: unknown): unknown {
  if (!value || typeof value !== "object" || !("default" in value)) {
    return value;
  }
  return (value as { default: unknown }).default;
}

function loadHeroDefinitions(): Record<string, SkillFile> {
  return Object.fromEntries(
    heroDefinitionModules.keys().map((modulePath) => {
      const name = modulePath.replace(/^\.\//, "").replace(/\.json$/, "");
      return [name, moduleDefault(heroDefinitionModules(modulePath)) as SkillFile];
    }),
  );
}

export function loadSimulatorConfig(): SimulatorConfig {
  return buildSimulatorConfig({
    heroGenerationStats:
      heroGenerationStatsJson as SimulatorConfig["heroGenerationStats"],
    troopSkills: troopSkillsJson as SkillFile,
    heroDefinitions: loadHeroDefinitions(),
  });
}
