// Canonical allowlist of simulator-relevant repo paths.
// Mirror of dashboard/sim_paths.py — keep the two lists in lockstep.
// Changes to dashboard code, scratch scripts, docs, or local test files cannot
// move a testcase result, so diffs scope to this list to answer board question
// 3 cleanly ("what changed in simulator code/config between two runs?").

export const SIMULATOR_PATH_PREFIXES: readonly string[] = [
  "Base_classes/",
  "assets/",
  "skills/",
  "testcases/",
  "fighters_data/",
  "battle_specs_manual/",
];

export const SIMULATOR_ROOT_FILES: ReadonlySet<string> = new Set<string>([
  "pyproject.toml",
  "check_testcases.py",
  "battle_main.py",
  "compare_results.py",
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
