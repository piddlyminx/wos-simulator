// Canonical allowlist of simulator-relevant repo paths.
// Mirror of dashboard/sim_paths.py — keep the two lists in lockstep.
// Changes to dashboard code, scratch scripts, docs, or local test files cannot
// move a testcase result, so diffs scope to this list to answer board question
// 3 cleanly ("what changed in simulator code/config between two runs?").

// Paths reflect the monorepo layout: the legacy Python simulator engine and its
// (legacy-schema) game assets live under archived/v1/; fighter stat profiles
// shared with the v3 tournament live under shared/. The ground-truth testcase
// corpus stays at the repo root (its path is a stable logical id). Scratch
// tooling (archived/v1/util) and tests are intentionally excluded.
export const SIMULATOR_PATH_PREFIXES: readonly string[] = [
  "archived/v1/Base_classes/",
  "archived/v1/assets/",
  "shared/fighters_data/",
  "testcases/",
];

export const SIMULATOR_ROOT_FILES: ReadonlySet<string> = new Set<string>([
  "pyproject.toml",
  "archived/v1/check_testcases.py",
  "archived/v1/battle_main.py",
  "archived/v1/compare_results.py",
]);

export function isSimulatorPath(relPath: string | undefined | null): boolean {
  if (!relPath) return false;
  const p = relPath.replace(/^[ab]\//, "");
  if (!p) return false;
  if (SIMULATOR_ROOT_FILES.has(p)) return true;
  for (const prefix of SIMULATOR_PATH_PREFIXES) {
    if (p.startsWith(prefix)) return true;
  }
  return false;
}
