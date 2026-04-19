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
import zlib from "zlib";
import type { CoverageTrendPoint, CoverageSnapshot, Hero, HeroCoverageDelta, HeroCoverageTimelinePoint, HeroSkill, HeroSkillHistoryRow, Run, RunDeltaCounts, RunTestcase, RunWithDelta, TestcaseChangelogRow, TestcaseDeltaRow, TestcaseTrendRow } from "@/types/dashboard";

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
      .prepare(
        `SELECT * FROM heroes ORDER BY CASE generation
          WHEN 'Gen 6' THEN 1 WHEN 'Gen 5' THEN 2 WHEN 'Gen 4' THEN 3
          WHEN 'Gen 3' THEN 4 WHEN 'Gen 2' THEN 5 WHEN 'Gen 1' THEN 6
          WHEN 'SR' THEN 7 ELSE 8 END, name`
      )
      .all() as Hero[];
  } catch (err) {
    console.error("[wos-dashboard] getHeroes failed:", err);
    return [];
  }
}

interface CoverageRow extends CoverageSnapshot {
  hero_generation: string | null;
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
        `SELECT cs.*, h.generation as hero_generation
         FROM coverage_snapshots cs
         LEFT JOIN heroes h ON cs.hero = h.name
         WHERE cs.run_id = ?
         ORDER BY CASE h.generation
           WHEN 'Gen 6' THEN 1 WHEN 'Gen 5' THEN 2 WHEN 'Gen 4' THEN 3
           WHEN 'Gen 3' THEN 4 WHEN 'Gen 2' THEN 5 WHEN 'Gen 1' THEN 6
           WHEN 'SR' THEN 7 ELSE 8 END, cs.hero, cs.skill_id`
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
 * Return decompressed patch text for a run, or null if the run has no patch blob.
 */
export function getRunPatch(runId: string): string | null {
  const database = getDb();
  if (!database) return null;
  try {
    const run = database
      .prepare(`SELECT patch_blob_id FROM runs WHERE id = ?`)
      .get(runId) as { patch_blob_id: string | null } | undefined;
    if (!run?.patch_blob_id) return null;
    const blob = database
      .prepare(`SELECT content_gzip FROM blobs WHERE id = ?`)
      .get(run.patch_blob_id) as { content_gzip: Buffer } | undefined;
    if (!blob?.content_gzip) return null;
    return zlib.gunzipSync(blob.content_gzip).toString("utf8");
  } catch (err) {
    console.error("[wos-dashboard] getRunPatch failed:", err);
    return null;
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

/**
 * Return names of required tables that are absent from the schema.
 * Used by pages to surface misconfiguration instead of silently returning empty data.
 */
export function getMissingTables(
  required = ["heroes", "hero_skills"]
): string[] {
  const database = getDb();
  if (!database) return required;
  try {
    const placeholders = required.map(() => "?").join(",");
    const existing = database
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${placeholders})`
      )
      .all(...required) as { name: string }[];
    const existingNames = new Set(existing.map((r) => r.name));
    return required.filter((t) => !existingNames.has(t));
  } catch {
    return required;
  }
}

/**
 * Compare two runs by their run_testcases and return counts of improved,
 * regressed, added, and retired testcases.
 */
export function getRunDeltaCounts(
  currRunId: string,
  prevRunId: string
): RunDeltaCounts {
  const database = getDb();
  if (!database) return { improved: 0, regressed: 0, added: 0, retired: 0 };
  try {
    const row = database
      .prepare(
        `WITH curr AS (
          SELECT file || '|' || testcase_id || '|' || CAST(idx AS TEXT) AS key, passes
          FROM run_testcases WHERE run_id = ?
        ),
        prev AS (
          SELECT file || '|' || testcase_id || '|' || CAST(idx AS TEXT) AS key, passes
          FROM run_testcases WHERE run_id = ?
        ),
        both AS (
          SELECT c.key, c.passes as curr_passes, p.passes as prev_passes
          FROM curr c JOIN prev p ON c.key = p.key
        )
        SELECT
          SUM(CASE WHEN prev_passes = 0 AND curr_passes = 1 THEN 1 ELSE 0 END) as improved,
          SUM(CASE WHEN prev_passes = 1 AND curr_passes = 0 THEN 1 ELSE 0 END) as regressed,
          (SELECT COUNT(*) FROM curr c2 WHERE c2.key NOT IN (SELECT key FROM prev)) as added,
          (SELECT COUNT(*) FROM prev p2 WHERE p2.key NOT IN (SELECT key FROM curr)) as retired
        FROM both`
      )
      .get(currRunId, prevRunId) as {
      improved: number | null;
      regressed: number | null;
      added: number | null;
      retired: number | null;
    };
    return {
      improved: row?.improved ?? 0,
      regressed: row?.regressed ?? 0,
      added: row?.added ?? 0,
      retired: row?.retired ?? 0,
    };
  } catch (err) {
    console.error("[wos-dashboard] getRunDeltaCounts failed:", err);
    return { improved: 0, regressed: 0, added: 0, retired: 0 };
  }
}

/**
 * Return runs (newest first) enriched with delta fields vs. the previous run.
 */
export function getRunsWithDelta(limit = 50): RunWithDelta[] {
  const database = getDb();
  if (!database) return [];
  try {
    const rows = database
      .prepare(`SELECT * FROM runs ORDER BY started_at DESC LIMIT ?`)
      .all(limit + 1) as Run[];

    const results: RunWithDelta[] = [];
    for (let i = 0; i < Math.min(rows.length, limit); i++) {
      const curr = rows[i];
      const prev = rows[i + 1] ?? null;

      const delta_avg_error_pct =
        prev != null &&
        curr.overall_avg_error_pct != null &&
        prev.overall_avg_error_pct != null
          ? curr.overall_avg_error_pct - prev.overall_avg_error_pct
          : null;

      const deltaCounts =
        prev != null
          ? getRunDeltaCounts(curr.id, prev.id)
          : { improved: 0, regressed: 0, added: 0, retired: 0 };

      results.push({
        ...curr,
        prev_run_id: prev?.id ?? null,
        delta_avg_error_pct,
        count_improved: deltaCounts.improved,
        count_regressed: deltaCounts.regressed,
        count_added: deltaCounts.added,
        count_retired: deltaCounts.retired,
      });
    }
    return results;
  } catch (err) {
    console.error("[wos-dashboard] getRunsWithDelta failed:", err);
    return [];
  }
}

/**
 * Return per-testcase delta rows for comparing runIdA (older) vs runIdB (newer).
 */
export function getRunDeltaTable(runIdA: string, runIdB: string): TestcaseDeltaRow[] {
  const database = getDb();
  if (!database) return [];
  try {
    const raw = database
      .prepare(
        `SELECT
          COALESCE(a.file, b.file) as file,
          COALESCE(a.testcase_id, b.testcase_id) as testcase_id,
          COALESCE(CAST(a.idx AS INTEGER), CAST(b.idx AS INTEGER)) as idx,
          a.bias_pct as bias_a,
          b.bias_pct as bias_b,
          a.passes as passes_a,
          b.passes as passes_b
        FROM run_testcases a
        LEFT JOIN run_testcases b
          ON a.file = b.file AND a.testcase_id = b.testcase_id AND a.idx = b.idx
          AND b.run_id = ?
        WHERE a.run_id = ?

        UNION

        SELECT
          b.file, b.testcase_id, CAST(b.idx AS INTEGER),
          a.bias_pct, b.bias_pct, a.passes, b.passes
        FROM run_testcases b
        LEFT JOIN run_testcases a
          ON a.file = b.file AND a.testcase_id = b.testcase_id AND a.idx = b.idx
          AND a.run_id = ?
        WHERE b.run_id = ? AND a.file IS NULL

        ORDER BY file, testcase_id, idx`
      )
      .all(runIdB, runIdA, runIdA, runIdB) as {
        file: string;
        testcase_id: string;
        idx: number;
        bias_a: number | null;
        bias_b: number | null;
        passes_a: number | null;
        passes_b: number | null;
      }[];

    return raw.map((r) => {
      let status: TestcaseDeltaRow["status"];
      if (r.passes_a == null) status = "added";
      else if (r.passes_b == null) status = "retired";
      else if (r.passes_a === 0 && r.passes_b === 1) status = "improved";
      else if (r.passes_a === 1 && r.passes_b === 0) status = "regressed";
      else status = "unchanged";

      const delta =
        r.bias_a != null && r.bias_b != null ? r.bias_b - r.bias_a : null;

      return { ...r, delta, status };
    });
  } catch (err) {
    console.error("[wos-dashboard] getRunDeltaTable failed:", err);
    return [];
  }
}

/**
 * Return per-testcase bias_pct history across the last `limit` runs.
 * Returns flat rows; the chart component pivots and computes variance.
 */
export function getTestcaseBiasTrend(limit = 50): TestcaseTrendRow[] {
  const database = getDb();
  if (!database) return [];
  try {
    return database
      .prepare(
        `SELECT rt.file, rt.testcase_id, rt.idx, r.id as run_id, r.started_at, rt.bias_pct
         FROM run_testcases rt
         JOIN runs r ON rt.run_id = r.id
         WHERE r.id IN (SELECT id FROM runs ORDER BY started_at DESC LIMIT ?)
         ORDER BY rt.file, rt.testcase_id, rt.idx, r.started_at ASC`
      )
      .all(limit) as TestcaseTrendRow[];
  } catch (err) {
    console.error("[wos-dashboard] getTestcaseBiasTrend failed:", err);
    return [];
  }
}

/**
 * Return trend data including bh_sig_count and dirty flag for the headline chart.
 * Fetches DESC then reverses so the chart reads oldest→newest left to right.
 */
export function getRunTrendWithBH(
  limit = 50
): {
  id: string;
  started_at: string;
  overall_avg_error_pct: number | null;
  bh_sig_count: number | null;
  dirty: number;
}[] {
  const database = getDb();
  if (!database) return [];
  try {
    const rows = database
      .prepare(
        `SELECT id, started_at, overall_avg_error_pct, bh_sig_count, dirty
         FROM runs
         ORDER BY started_at DESC
         LIMIT ?`
      )
      .all(limit) as {
      id: string;
      started_at: string;
      overall_avg_error_pct: number | null;
      bh_sig_count: number | null;
      dirty: number;
    }[];
    return rows.reverse();
  } catch (err) {
    console.error("[wos-dashboard] getRunTrendWithBH failed:", err);
    return [];
  }
}

/**
 * Return per-run coverage trend: heroes covered + hero-skill pairs covered.
 * Fetches DESC then reverses so the chart reads oldest→newest left to right.
 */
export function getCoverageTrend(limit = 50): CoverageTrendPoint[] {
  const database = getDb();
  if (!database) return [];
  try {
    const rows = database
      .prepare(
        `SELECT r.id as run_id, r.started_at,
           COUNT(DISTINCT CASE WHEN cs.covered_bool = 1 THEN cs.hero END) as heroes_covered,
           SUM(CASE WHEN cs.covered_bool = 1 THEN 1 ELSE 0 END) as pairs_covered
         FROM runs r
         JOIN coverage_snapshots cs ON cs.run_id = r.id
         WHERE r.id IN (SELECT id FROM runs ORDER BY started_at DESC LIMIT ?)
         GROUP BY r.id, r.started_at
         ORDER BY r.started_at DESC`
      )
      .all(limit) as CoverageTrendPoint[];
    return rows.reverse();
  } catch (err) {
    console.error("[wos-dashboard] getCoverageTrend failed:", err);
    return [];
  }
}

/**
 * Return per-run testcase count + skill coverage % for a given hero.
 * Ordered oldest → newest (for chart).
 */
export function getHeroCoverageTimeline(heroName: string, limit = 100): HeroCoverageTimelinePoint[] {
  const database = getDb();
  if (!database) return [];
  try {
    const rows = database
      .prepare(
        `SELECT
           r.id as run_id,
           r.started_at,
           SUM(cs.testcase_count) as testcase_count,
           COUNT(*) as skills_total,
           SUM(cs.covered_bool) as skills_covered,
           ROUND(100.0 * SUM(cs.covered_bool) / COUNT(*), 1) as coverage_pct
         FROM runs r
         JOIN coverage_snapshots cs ON cs.run_id = r.id
         WHERE cs.hero = ? AND r.id IN (SELECT id FROM runs ORDER BY started_at DESC LIMIT ?)
         GROUP BY r.id, r.started_at
         ORDER BY r.started_at ASC`
      )
      .all(heroName, limit) as HeroCoverageTimelinePoint[];
    return rows;
  } catch (err) {
    console.error("[wos-dashboard] getHeroCoverageTimeline failed:", err);
    return [];
  }
}

/**
 * Return per-skill history (first covered, last changed, currently covered) for a hero.
 */
export function getHeroSkillHistory(heroName: string): HeroSkillHistoryRow[] {
  const database = getDb();
  if (!database) return [];
  try {
    const rows = database
      .prepare(
        `WITH ordered AS (
           SELECT cs.skill_id, cs.skill_name, cs.covered_bool,
                  r.started_at, r.id as run_id,
                  ROW_NUMBER() OVER (PARTITION BY cs.skill_id ORDER BY r.started_at DESC) as rn
           FROM coverage_snapshots cs
           JOIN runs r ON cs.run_id = r.id
           WHERE cs.hero = ?
         ),
         latest AS (
           SELECT skill_id, skill_name, covered_bool as currently_covered
           FROM ordered WHERE rn = 1
         ),
         first_covered AS (
           SELECT skill_id, MIN(started_at) as first_seen_at
           FROM ordered WHERE covered_bool = 1
           GROUP BY skill_id
         ),
         changes AS (
           SELECT o1.skill_id, MAX(o1.started_at) as last_changed_at
           FROM ordered o1
           JOIN ordered o2 ON o1.skill_id = o2.skill_id AND o1.rn = o2.rn - 1
           WHERE o1.covered_bool != o2.covered_bool
           GROUP BY o1.skill_id
         )
         SELECT l.skill_id, l.skill_name, l.currently_covered,
                fc.first_seen_at, ch.last_changed_at
         FROM latest l
         LEFT JOIN first_covered fc ON l.skill_id = fc.skill_id
         LEFT JOIN changes ch ON l.skill_id = ch.skill_id
         ORDER BY CAST(l.skill_id AS INTEGER)`
      )
      .all(heroName) as HeroSkillHistoryRow[];
    return rows;
  } catch (err) {
    console.error("[wos-dashboard] getHeroSkillHistory failed:", err);
    return [];
  }
}

/**
 * Return per-hero coverage delta between two runs.
 * Only heroes where covered_skills or testcase totals changed are returned.
 */
export function getHeroCoverageDeltas(
  currRunId: string,
  prevRunId: string
): HeroCoverageDelta[] {
  const database = getDb();
  if (!database) return [];
  try {
    return database
      .prepare(
        `WITH curr AS (
           SELECT hero,
             SUM(covered_bool) as covered_skills,
             SUM(testcase_count) as total_tc
           FROM coverage_snapshots WHERE run_id = ?
           GROUP BY hero
         ),
         prev AS (
           SELECT hero,
             SUM(covered_bool) as covered_skills,
             SUM(testcase_count) as total_tc
           FROM coverage_snapshots WHERE run_id = ?
           GROUP BY hero
         )
         SELECT
           COALESCE(c.hero, p.hero) as hero,
           COALESCE(c.covered_skills, 0) - COALESCE(p.covered_skills, 0) as delta_skills,
           COALESCE(c.total_tc, 0) - COALESCE(p.total_tc, 0) as delta_testcases
         FROM curr c
         FULL OUTER JOIN prev p ON c.hero = p.hero
         WHERE COALESCE(c.covered_skills, 0) != COALESCE(p.covered_skills, 0)
            OR COALESCE(c.total_tc, 0) != COALESCE(p.total_tc, 0)
         ORDER BY hero`
      )
      .all(currRunId, prevRunId) as HeroCoverageDelta[];
  } catch (err) {
    console.error("[wos-dashboard] getHeroCoverageDeltas failed:", err);
    return [];
  }
}

/**
 * Return per-file-path lifecycle rows aggregated across every run.
 *
 * For each distinct `run_testcase_files.file_path` the query derives:
 *   - first_seen_run_id / first_seen_at: earliest run that included the file
 *   - last_seen_run_id  / last_seen_at:  most recent run that included the file
 *   - last_modified_run_id / last_modified_at: most recent run where the sha256
 *     differed from the previous seen sha256 (first appearance also counts)
 *   - run_count: distinct runs the file appeared in
 *   - retired: 1 iff last_seen_run_id is not the globally most-recent run
 *
 * Runs without `started_at` are excluded so ordering is deterministic.
 */
export function getTestcaseChangelog(): TestcaseChangelogRow[] {
  const database = getDb();
  if (!database) return [];
  try {
    return database
      .prepare(
        `WITH latest_run AS (
           SELECT id FROM runs WHERE started_at IS NOT NULL
           ORDER BY started_at DESC LIMIT 1
         ),
         file_runs AS (
           SELECT rtf.file_path, rtf.sha256, rtf.run_id, r.started_at
           FROM run_testcase_files rtf
           JOIN runs r ON rtf.run_id = r.id
           WHERE r.started_at IS NOT NULL
         ),
         ranked AS (
           SELECT file_path, sha256, run_id, started_at,
             LAG(sha256) OVER (PARTITION BY file_path ORDER BY started_at) AS prev_sha
           FROM file_runs
         ),
         modified AS (
           SELECT file_path, MAX(started_at) AS last_modified_at
           FROM ranked
           WHERE prev_sha IS NULL OR prev_sha != sha256
           GROUP BY file_path
         ),
         modified_run AS (
           SELECT ranked.file_path,
                  ranked.run_id AS last_modified_run_id,
                  ranked.started_at AS last_modified_at
           FROM ranked
           JOIN modified m ON ranked.file_path = m.file_path
                          AND ranked.started_at = m.last_modified_at
         ),
         agg AS (
           SELECT file_path,
             COUNT(DISTINCT run_id) AS run_count,
             MIN(started_at) AS first_seen_at,
             MAX(started_at) AS last_seen_at
           FROM file_runs GROUP BY file_path
         ),
         first_run AS (
           SELECT fr.file_path, fr.run_id AS first_seen_run_id
           FROM file_runs fr
           JOIN agg a ON fr.file_path = a.file_path
                     AND fr.started_at = a.first_seen_at
         ),
         last_run AS (
           SELECT fr.file_path, fr.run_id AS last_seen_run_id
           FROM file_runs fr
           JOIN agg a ON fr.file_path = a.file_path
                     AND fr.started_at = a.last_seen_at
         )
         SELECT
           a.file_path,
           a.run_count,
           f.first_seen_run_id,
           a.first_seen_at,
           l.last_seen_run_id,
           a.last_seen_at,
           m.last_modified_run_id,
           m.last_modified_at,
           CASE WHEN l.last_seen_run_id != (SELECT id FROM latest_run)
                THEN 1 ELSE 0 END AS retired
         FROM agg a
         JOIN first_run f ON a.file_path = f.file_path
         JOIN last_run l ON a.file_path = l.file_path
         JOIN modified_run m ON a.file_path = m.file_path
         ORDER BY a.file_path`
      )
      .all() as TestcaseChangelogRow[];
  } catch (err) {
    console.error("[wos-dashboard] getTestcaseChangelog failed:", err);
    return [];
  }
}
