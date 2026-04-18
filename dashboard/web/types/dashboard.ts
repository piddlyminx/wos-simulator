/**
 * TypeScript types derived from the WOS simulator dashboard SQLite schema.
 *
 * Note: SQLite INTEGER booleans (0/1) are typed as `number` here because
 * better-sqlite3 returns raw integers, not JS booleans.
 */

export interface Run {
  id: string;
  started_at: string;
  finished_at: string;
  git_sha: string;
  dirty: number; // 0 | 1
  baseline_git_sha: string;
  cli_args_json: string;
  thresholds_json: string;
  overall_avg_error_pct: number;
  bh_sig_count: number;
  summary_json: string;
  patch_blob_id: string | null;
  untracked_blob_id: string | null;
}

export interface RunTestcase {
  run_id: string;
  file: string;
  testcase_id: string;
  idx: number;
  n_sim: number;
  n_game: number;
  mu_sim: number;
  mu_game: number;
  bias_pct: number;
  t: number;
  q: number;
  passes: number; // 0 | 1
  stat_type: string;
  waived_bool: number; // 0 | 1
}

export interface RunTestcaseFile {
  run_id: string;
  file_path: string;
  sha256: string;
}

export interface Blob {
  id: string;
  kind: "patch" | "untracked_manifest";
  contentGzip: Buffer;
}

export interface Hero {
  name: string;
  classes: string; // JSON array string
  tier: string;
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
