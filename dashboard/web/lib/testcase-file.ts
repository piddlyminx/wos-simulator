import "server-only";
import fs from "fs";
import path from "path";
import { resolveRepoRoot } from "./diff";

export { testcaseDetailHref, testcaseFileFromPath } from "./testcase-href";

/**
 * Shape of a single testcase entry in a `testcases/emulator_verified/*.json`
 * file. Fields that aren't always present are typed as optional.
 */
export interface TestcaseArmyStats {
  attack?: number;
  defense?: number;
  lethality?: number;
  health?: number;
  [k: string]: number | undefined;
}

export interface TestcaseArmy {
  name?: string;
  heroes?: Record<string, Record<string, number>>;
  troops?: Record<string, number>;
  stats?: Record<string, TestcaseArmyStats>;
  joiner_heroes?: Record<string, Record<string, number>>;
}

export interface TestcaseBattleResult {
  attacker?: number;
  defender?: number;
}

export interface RawTestcase {
  test_id?: string;
  description?: string;
  attacker?: TestcaseArmy;
  defender?: TestcaseArmy;
  sim_result?: TestcaseBattleResult;
  game_report_result?: TestcaseBattleResult[];
  [k: string]: unknown;
}

/**
 * Resolve the absolute path for a testcase file referenced in the DB.
 * Testcase file paths are stored relative to the simulator repo root,
 * e.g. `testcases/emulator_verified/molly_solo.json`.
 */
export function resolveTestcaseAbsPath(filePath: string): string | null {
  const root = resolveRepoRoot();
  if (!root) return null;
  return path.resolve(root, filePath);
}

/**
 * Read and parse a testcase JSON file from disk.
 * Returns null if the file cannot be found or parsed; the caller is expected
 * to render the historical DB-only view in that case (files can be retired).
 */
export function readTestcaseFile(filePath: string): RawTestcase[] | null {
  const abs = resolveTestcaseAbsPath(filePath);
  if (!abs) return null;
  if (!fs.existsSync(abs)) return null;
  try {
    const raw = fs.readFileSync(abs, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as RawTestcase[];
  } catch (err) {
    console.error(`[wos-dashboard] readTestcaseFile(${filePath}) failed:`, err);
    return null;
  }
}
