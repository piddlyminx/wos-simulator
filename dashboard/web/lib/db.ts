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
import type { CoverageSnapshot, Hero, Run, RunTestcase } from "@/types/dashboard";

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
