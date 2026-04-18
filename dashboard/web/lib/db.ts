/**
 * Singleton better-sqlite3 database reader for the WOS simulator dashboard.
 *
 * The DB lives at:
 *   <repo-root>/test_results/dashboard.sqlite
 *
 * When running `npm run dev` from dashboard/web/, process.cwd() is
 * dashboard/web/, so we resolve two levels up to reach the repo root,
 * then descend into test_results/.
 *
 * Override via DB_PATH env var if needed.
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import type { CoverageSnapshot, Hero, HeroSkill, Run, RunTestcase } from "@/types/dashboard";

/**
 * Absolute path to the SQLite database file.
 * Override via the DB_PATH environment variable.
 * Default resolves from dashboard/web/ up to the repo root, then into test_results/.
 */
export const DB_PATH =
  process.env.DB_PATH ??
  path.resolve(process.cwd(), "../../test_results/dashboard.sqlite");

let _db: Database.Database | null = null;
let _dbInitialized = false;

function getDb(): Database.Database | null {
  if (_dbInitialized) return _db;
  _dbInitialized = true;

  if (!fs.existsSync(DB_PATH)) {
    console.warn(
      `[wos-dashboard] DB not found at ${DB_PATH}. ` +
        "Run check_testcases.py to generate it."
    );
    _db = null;
    return null;
  }

  try {
    _db = new Database(DB_PATH, { readonly: true });
    console.info(`[wos-dashboard] Opened DB at ${DB_PATH}`);
  } catch (err) {
    console.error(`[wos-dashboard] Failed to open DB at ${DB_PATH}:`, err);
    _db = null;
  }

  return _db;
}

/** The underlying Database instance, or null if the DB file is missing. */
export const db = getDb();

/**
 * Return runs ordered by started_at DESC.
 * @param limit defaults to 100
 */
export function getRuns(limit = 100): Run[] {
  const database = getDb();
  if (!database) return [];
  try {
    return database
      .prepare(
        `SELECT * FROM runs ORDER BY started_at DESC LIMIT ?`
      )
      .all(limit) as Run[];
  } catch (err) {
    console.error("[wos-dashboard] getRuns failed:", err);
    return [];
  }
}

/**
 * Return a single run by id, or undefined if not found.
 */
export function getRun(id: string): Run | undefined {
  const database = getDb();
  if (!database) return undefined;
  try {
    return database
      .prepare(`SELECT * FROM runs WHERE id = ?`)
      .get(id) as Run | undefined;
  } catch (err) {
    console.error("[wos-dashboard] getRun failed:", err);
    return undefined;
  }
}

/**
 * Return all testcase rows for a given run.
 */
export function getRunTestcases(runId: string): RunTestcase[] {
  const database = getDb();
  if (!database) return [];
  try {
    return database
      .prepare(
        `SELECT * FROM run_testcases WHERE run_id = ? ORDER BY file, idx`
      )
      .all(runId) as RunTestcase[];
  } catch (err) {
    console.error("[wos-dashboard] getRunTestcases failed:", err);
    return [];
  }
}

/**
 * Return the total number of runs in the DB.
 */
export function getRunCount(): number {
  const database = getDb();
  if (!database) return 0;
  try {
    const row = database
      .prepare(`SELECT count(*) as count FROM runs`)
      .get() as { count: number };
    return row.count;
  } catch (err) {
    console.error("[wos-dashboard] getRunCount failed:", err);
    return 0;
  }
}

/**
 * Return all heroes ordered by tier then name.
 */
export function getHeroes(): Hero[] {
  const database = getDb();
  if (!database) return [];
  try {
    return database
      .prepare(`SELECT * FROM heroes ORDER BY tier, name`)
      .all() as Hero[];
  } catch (err) {
    console.error("[wos-dashboard] getHeroes failed:", err);
    return [];
  }
}

interface CoverageRow extends CoverageSnapshot {
  hero_tier: string | null;
}

/**
 * Return coverage snapshots for a given run, joined with hero tier.
 * Pass runId = "latest" to automatically use the most recent run.
 */
export function getCoverageSnapshots(runId: string): CoverageRow[] {
  const database = getDb();
  if (!database) return [];
  try {
    let resolvedId = runId;
    if (runId === "latest") {
      const latestRun = database
        .prepare(`SELECT id FROM runs ORDER BY started_at DESC LIMIT 1`)
        .get() as { id: string } | undefined;
      if (!latestRun) return [];
      resolvedId = latestRun.id;
    }
    return database
      .prepare(
        `SELECT cs.*, h.tier as hero_tier
         FROM coverage_snapshots cs
         LEFT JOIN heroes h ON cs.hero = h.name
         WHERE cs.run_id = ?
         ORDER BY h.tier, cs.hero, cs.skill_id`
      )
      .all(resolvedId) as CoverageRow[];
  } catch (err) {
    console.error("[wos-dashboard] getCoverageSnapshots failed:", err);
    return [];
  }
}

/**
 * Return the id of the most recent run, or undefined if no runs exist.
 */
export function getLatestRunId(): string | undefined {
  const database = getDb();
  if (!database) return undefined;
  try {
    const row = database
      .prepare(`SELECT id FROM runs ORDER BY started_at DESC LIMIT 1`)
      .get() as { id: string } | undefined;
    return row?.id;
  } catch (err) {
    console.error("[wos-dashboard] getLatestRunId failed:", err);
    return undefined;
  }
}

/**
 * Return distinct skill_ids from coverage_snapshots for a given run.
 */
export function getDistinctSkillIds(runId: string): string[] {
  const database = getDb();
  if (!database) return [];
  try {
    const rows = database
      .prepare(
        `SELECT DISTINCT skill_id FROM coverage_snapshots WHERE run_id = ? ORDER BY skill_id`
      )
      .all(runId) as { skill_id: string }[];
    return rows.map((r) => r.skill_id);
  } catch (err) {
    console.error("[wos-dashboard] getDistinctSkillIds failed:", err);
    return [];
  }
}

/**
 * Return all coverage snapshot rows for a given run (used for matrix pivot).
 */
export function getCoverageMatrix(runId: string): CoverageSnapshot[] {
  const database = getDb();
  if (!database) return [];
  try {
    return database
      .prepare(`SELECT * FROM coverage_snapshots WHERE run_id = ?`)
      .all(runId) as CoverageSnapshot[];
  } catch (err) {
    console.error("[wos-dashboard] getCoverageMatrix failed:", err);
    return [];
  }
}

/**
 * Return a blob's raw gzipped content by its id.
 */
export function getBlob(blobId: string): { content_gzip: Buffer } | undefined {
  const database = getDb();
  if (!database) return undefined;
  try {
    return database
      .prepare(`SELECT content_gzip FROM blobs WHERE id = ?`)
      .get(blobId) as { content_gzip: Buffer } | undefined;
  } catch (err) {
    console.error("[wos-dashboard] getBlob failed:", err);
    return undefined;
  }
}

/**
 * Return the run immediately before the given run (by started_at).
 */
export function getPreviousRun(currentRunId: string): Run | undefined {
  const database = getDb();
  if (!database) return undefined;
  try {
    const current = database
      .prepare(`SELECT started_at FROM runs WHERE id = ?`)
      .get(currentRunId) as { started_at: string } | undefined;
    if (!current) return undefined;
    return database
      .prepare(
        `SELECT * FROM runs WHERE started_at < ? ORDER BY started_at DESC LIMIT 1`
      )
      .get(current.started_at) as Run | undefined;
  } catch (err) {
    console.error("[wos-dashboard] getPreviousRun failed:", err);
    return undefined;
  }
}

/**
 * Return the file+testcase_id+idx keys for all testcases in a run (for set-diff).
 */
export function getRunTestcaseKeys(
  runId: string
): { file: string; testcase_id: string; idx: number }[] {
  const database = getDb();
  if (!database) return [];
  try {
    return database
      .prepare(
        `SELECT file, testcase_id, idx FROM run_testcases WHERE run_id = ? ORDER BY file, testcase_id, idx`
      )
      .all(runId) as { file: string; testcase_id: string; idx: number }[];
  } catch (err) {
    console.error("[wos-dashboard] getRunTestcaseKeys failed:", err);
    return [];
  }
}

/**
 * Return trend data (latest N runs) for the sparkline chart.
 */
export function getRunTrend(
  limit = 50
): { id: string; started_at: string; overall_avg_error_pct: number }[] {
  const database = getDb();
  if (!database) return [];
  try {
    // Fetch DESC then reverse so chart reads oldest→newest left to right.
    const rows = database
      .prepare(
        `SELECT id, started_at, overall_avg_error_pct
         FROM runs
         ORDER BY started_at DESC
         LIMIT ?`
      )
      .all(limit) as {
      id: string;
      started_at: string;
      overall_avg_error_pct: number;
    }[];
    return rows.reverse();
  } catch (err) {
    console.error("[wos-dashboard] getRunTrend failed:", err);
    return [];
  }
}

/**
 * Return a single hero by name.
 */
export function getHero(name: string): Hero | undefined {
  const database = getDb();
  if (!database) return undefined;
  try {
    return database
      .prepare(`SELECT * FROM heroes WHERE name = ?`)
      .get(name) as Hero | undefined;
  } catch (err) {
    console.error("[wos-dashboard] getHero failed:", err);
    return undefined;
  }
}

/**
 * Return all skills for a given hero.
 */
export function getHeroSkills(heroName: string): HeroSkill[] {
  const database = getDb();
  if (!database) return [];
  try {
    return database
      .prepare(`SELECT * FROM hero_skills WHERE hero = ? ORDER BY skill_id`)
      .all(heroName) as HeroSkill[];
  } catch (err) {
    console.error("[wos-dashboard] getHeroSkills failed:", err);
    return [];
  }
}

/**
 * Return testcase rows for a given hero from a specific run.
 * Matches by hero name appearing in the file path.
 */
export function getHeroTestcases(
  heroName: string,
  runId: string
): RunTestcase[] {
  const database = getDb();
  if (!database) return [];
  try {
    return database
      .prepare(
        `SELECT * FROM run_testcases
         WHERE run_id = ? AND lower(file) LIKE lower(?)
         ORDER BY file, idx`
      )
      .all(runId, `%${heroName}%`) as RunTestcase[];
  } catch (err) {
    console.error("[wos-dashboard] getHeroTestcases failed:", err);
    return [];
  }
}

/**
 * Return average bias_pct per run for testcases involving a given hero.
 */
export function getHeroErrorHistory(
  heroName: string
): { started_at: string; avg_bias_pct: number }[] {
  const database = getDb();
  if (!database) return [];
  try {
    const rows = database
      .prepare(
        `SELECT r.started_at, AVG(rt.bias_pct) as avg_bias_pct
         FROM run_testcases rt
         JOIN runs r ON rt.run_id = r.id
         WHERE lower(rt.file) LIKE lower(?)
         GROUP BY rt.run_id
         ORDER BY r.started_at ASC`
      )
      .all(`%${heroName}%`) as { started_at: string; avg_bias_pct: number }[];
    return rows;
  } catch (err) {
    console.error("[wos-dashboard] getHeroErrorHistory failed:", err);
    return [];
  }
}
