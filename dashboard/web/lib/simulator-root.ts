import fs from "fs";
import path from "path";

function isSimulatorRoot(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, "dashboard", "web", "package.json")) &&
    fs.existsSync(path.join(dir, "test_results"))
  );
}

export function resolveSimulatorRoot(cwd = process.cwd()): string {
  if (process.env.WOS_SIMULATOR_ROOT) {
    return path.resolve(process.env.WOS_SIMULATOR_ROOT);
  }

  const candidates = [
    cwd,
    path.resolve(cwd, ".."),
    path.resolve(cwd, "../.."),
  ];

  const found = candidates.find(isSimulatorRoot);
  return found ?? path.resolve(cwd, "../..");
}

export function resolveRuntimeStoreDir(): string {
  if (process.env.SIM_RUNS_DIR) {
    return path.resolve(process.env.SIM_RUNS_DIR);
  }
  return path.join(resolveSimulatorRoot(), "tmp");
}
