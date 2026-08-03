import fs from "node:fs";
import path from "node:path";

import type { CoverageSnapshot } from "@/types/dashboard";
import { resolveSimulatorRoot } from "./simulator-root";

type TestcaseEntry = {
  attacker?: FighterEntry;
  defender?: FighterEntry;
  game_report_result?: unknown;
};

type FighterEntry = {
  heroes?: Record<string, Record<string, unknown>>;
  joiner_heroes?: Record<string, Record<string, unknown>>;
};

function activeTestcaseFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...activeTestcaseFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(fullPath);
  }
  return files.sort();
}

function entriesFromFile(file: string): TestcaseEntry[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries.filter(
      (entry): entry is TestcaseEntry => typeof entry === "object" && entry !== null
    );
  } catch {
    return [];
  }
}

function heroEntries(entry: TestcaseEntry, hero: string): Record<string, unknown>[] {
  const matches: Record<string, unknown>[] = [];
  for (const side of [entry.attacker, entry.defender]) {
    for (const collection of [side?.heroes, side?.joiner_heroes]) {
      const levels = collection?.[hero];
      if (levels && typeof levels === "object") matches.push(levels);
    }
  }
  return matches;
}

function outcomeCount(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  return result && typeof result === "object" ? 1 : 0;
}

export function applyLiveTestcaseCoverage(
  snapshots: readonly CoverageSnapshot[],
  testcaseRoot = path.join(resolveSimulatorRoot(), "testcases")
): CoverageSnapshot[] {
  const heroes = [...new Set(snapshots.map((row) => row.hero))];
  const skillIdsByHero = new Map<string, Set<string>>();
  for (const row of snapshots) {
    const ids = skillIdsByHero.get(row.hero) ?? new Set<string>();
    ids.add(row.skill_id);
    skillIdsByHero.set(row.hero, ids);
  }

  const testcaseCount = new Map<string, number>();
  const battleOutcomeCount = new Map<string, number>();

  for (const file of activeTestcaseFiles(testcaseRoot)) {
    for (const entry of entriesFromFile(file)) {
      const entryOutcomeCount = outcomeCount(entry.game_report_result);
      for (const hero of heroes) {
        const levels = heroEntries(entry, hero);
        if (levels.length === 0) continue;
        for (const skillId of skillIdsByHero.get(hero) ?? []) {
          if (levels.some((heroLevels) => Number(heroLevels[`skill_${skillId}`] ?? 0) > 0)) {
            const key = `${hero}\u0000${skillId}`;
            testcaseCount.set(key, (testcaseCount.get(key) ?? 0) + 1);
            battleOutcomeCount.set(
              key,
              (battleOutcomeCount.get(key) ?? 0) + entryOutcomeCount
            );
          }
        }
      }
    }
  }

  return snapshots.map((row) => {
    const key = `${row.hero}\u0000${row.skill_id}`;
    const count = testcaseCount.get(key) ?? 0;
    return {
      ...row,
      testcase_count: count,
      battle_outcome_count: battleOutcomeCount.get(key) ?? 0,
      covered_bool: count > 0 ? 1 : 0
    };
  });
}
