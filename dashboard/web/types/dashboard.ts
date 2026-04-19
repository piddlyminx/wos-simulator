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
}

export interface RunWithDelta extends Run {
  prev_run_id: string | null;
  delta_avg_error_pct: number | null;
  count_improved: number;
  count_regressed: number;
  count_added: number;
  count_retired: number;
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
  status: "improved" | "regressed" | "unchanged" | "added" | "retired";
}
