// Canonical allowlist of simulator-relevant repo paths.
// Mirror of dashboard/sim_paths.py — keep the two lists in lockstep.
// Changes to dashboard code, scratch scripts, docs, or local test files cannot
// move a testcase result, so diffs scope to this list to answer board question
// 3 cleanly ("what changed in simulator code/config between two runs?").

// Paths reflect the monorepo layout: the TypeScript simulator engine and native
// config live under simulator/. Fighter stat profiles shared with scripts live
// under shared/. The ground-truth testcase corpus stays at the repo root because
// its path is a stable logical id.
export const SIMULATOR_PATH_PREFIXES: readonly string[] = [
  "simulator/config/",
  "simulator/src/",
  "shared/fighters_data/",
  "testcases/",
];

export const SIMULATOR_ROOT_FILES: ReadonlySet<string> = new Set<string>([
  "simulator/package.json",
  "simulator/package-lock.json",
  "simulator/tsconfig.json",
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
