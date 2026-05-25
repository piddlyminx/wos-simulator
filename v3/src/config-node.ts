import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { buildSimulatorConfig, type RawSimulatorConfig } from "./config";
import type { SimulatorConfig, SkillFile } from "./types";

export function loadSimulatorConfigFromDir(configDir: string): SimulatorConfig {
  const root = resolve(configDir);
  const heroDir = join(root, "hero_definitions");
  const heroDefinitions: Record<string, SkillFile> = {};
  for (const file of readdirSync(heroDir).filter((name) => name.endsWith(".json")).sort()) {
    heroDefinitions[file.slice(0, -".json".length)] = readJson(join(heroDir, file)) as SkillFile;
  }
  const raw: RawSimulatorConfig = {
    troopStats: readJson(join(root, "troop_stats.json")) as SimulatorConfig["troopStats"],
    heroGenerationStats: readJson(join(root, "hero_generation_stats.json")) as SimulatorConfig["heroGenerationStats"],
    troopSkills: readJson(join(root, "troop_skills.json")) as SkillFile,
    heroDefinitions,
    fileLabel(kind, key) {
      if (kind === "hero_definition") return relative(process.cwd(), join(heroDir, `${key}.json`));
      if (kind === "troop_stats") return relative(process.cwd(), join(root, "troop_stats.json"));
      if (kind === "hero_generation_stats") return relative(process.cwd(), join(root, "hero_generation_stats.json"));
      return relative(process.cwd(), join(root, "troop_skills.json"));
    }
  };
  return buildSimulatorConfig(raw);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}
