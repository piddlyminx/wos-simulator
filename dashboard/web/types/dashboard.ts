/**
 * TypeScript types derived from the WOS simulator dashboard SQLite schema.
 *
 * Note: SQLite INTEGER booleans (0/1) are typed as `number` here because
 * better-sqlite3 returns raw integers, not JS booleans.
 */

export interface Run {
  id: string;
  started_at: string | null;
  finished_at: string;
  git_sha: string;
  dirty: number; // 0 | 1
  baseline_git_sha: string | null;
  cli_args_json: string;
  thresholds_json: string;
  overall_avg_error_pct: number | null;
  bh_sig_count: number | null;
  summary_json: string;
  patch_blob_id: string | null;
  untracked_blob_id: string | null;
}

export interface RunTestcase {
  id: number; // AUTOINCREMENT surrogate key
  run_id: string;
  file: string;
  testcase_id: string;
  idx: number;
  n_sim: number;
  n_game: number;
  mu_sim: number | null;
  mu_game: number | null;
  bias_pct: number | null;
  t: number | null;
  q: number | null;
  passes: number; // 0 | 1
  stat_type: string;
  waived_bool: number; // 0 | 1
}

export interface RunTestcaseFile {
  id: number; // AUTOINCREMENT surrogate key
  run_id: string;
  file_path: string;
  sha256: string;
  included: number; // 0 | 1 — 1 = executed in this run, 0 = present but filter-excluded
}

export interface Blob {
  id: string;
  kind: "patch" | "untracked_manifest";
  content_gzip: Buffer; // raw column name — better-sqlite3 returns snake_case
}

export interface Hero {
  name: string;
  classes: string; // JSON array string
  generation: string | null;
}

export interface HeroSkill {
  hero: string;
  skill_id: string;
  name: string;
  json_path: string;
}

export interface CoverageSnapshot {
  run_id: string;
  hero: string;
  skill_id: string;
  testcase_count: number;
  battle_outcome_count: number;
  covered_bool: number; // 0 | 1
}

export interface RunDeltaCounts {
  improved: number;
  regressed: number;
  added: number;
  retired: number;
  skipped: number;
}

export interface RunWithDelta extends Run {
  prev_run_id: string | null;
  delta_avg_error_pct: number | null;
  count_improved: number;
  count_regressed: number;
  count_added: number;
  count_retired: number;
  count_skipped: number;
}

export interface TestcaseTrendRow {
  file: string;
  testcase_id: string;
  idx: number;
  run_id: string;
  started_at: string;
  bias_pct: number | null;
}

export interface TestcaseDeltaRow {
  file: string;
  testcase_id: string;
  idx: number;
  bias_a: number | null;
  bias_b: number | null;
  delta: number | null;
  passes_a: number | null;
  passes_b: number | null;
  status: "improved" | "regressed" | "unchanged" | "added" | "retired" | "skipped";
}

export interface CoverageTrendPoint {
  run_id: string;
  started_at: string;
  heroes_covered: number;
  pairs_covered: number;
}

export interface HeroCoverageDelta {
  hero: string;
  delta_skills: number;
  delta_testcases: number;
}

export interface HeroCoverageTimelinePoint {
  run_id: string;
  started_at: string;
  testcase_count: number;     // total testcase_count for this hero in this run
  skills_total: number;       // total skills for this hero
  skills_covered: number;     // count of covered_bool=1 skills
  coverage_pct: number;       // skills_covered / skills_total * 100
}

export interface HeroSkillHistoryRow {
  skill_id: string;
  skill_name: string;
  currently_covered: number;          // 0 | 1 from latest run
  first_seen_at: string | null;       // started_at of first run where covered_bool=1
  last_changed_at: string | null;     // started_at of run where covered_bool last changed
}

export interface TestcaseChangelogRow {
  file_path: string;
  run_count: number;
  first_seen_run_id: string;
  first_seen_at: string;
  last_seen_run_id: string;
  last_seen_at: string;
  last_modified_run_id: string;
  last_modified_at: string;
  retired: number; // 0 | 1
}

export interface TopRegressionRow {
  file: string;
  testcase_id: string;
  idx: number;
  bias_old: number | null;
  bias_new: number | null;
  passes_old: number | null;
  passes_new: number | null;
  delta: number | null;
  window_start_run_id: string;
  window_end_run_id: string;
}

/**
 * Per-run, per-testcase-row history for a single testcase file.
 * Result of joining `run_testcases` with `runs`.
 */
export interface TestcaseFileHistoryRow {
  run_id: string;
  started_at: string | null;
  testcase_id: string;
  idx: number;
  n_sim: number;
  n_game: number;
  mu_sim: number | null;
  mu_game: number | null;
  bias_pct: number | null;
  t: number | null;
  q: number | null;
  passes: number;
  stat_type: string;
  waived_bool: number;
}

/**
 * Per-file aggregate shown on the /testcases index page.
 * Derived from `run_testcase_files` + the latest run's `run_testcases`.
 */
export interface TestcaseFileIndexRow {
  file_path: string;
  first_seen_at: string | null;
  last_seen_at: string | null;
  run_count: number;
  retired: number; // 0 | 1
  /** Number of testcase rows the file emitted in the latest run (0 if retired/skipped). */
  latest_testcase_count: number;
  latest_pass_count: number;
  latest_bias_pct: number | null; // mean |bias_pct| across testcases in latest run
  latest_any_waived: number; // 0 | 1
  latest_any_bh_sig: number; // 0 | 1 (q <= 0.05 AND passes = 0)
}
