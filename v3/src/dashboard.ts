import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileExists } from "./config.js";

export interface DashboardComparison {
  dashboardAvailable: boolean;
  latestRun?: { id: string; finishedAt: string; gitSha: string; testcaseFiles?: number; includedTestcaseFiles?: number };
}

export interface DashboardCaseComparison {
  runId?: string;
  idx?: number;
  muSim?: number | null;
  muGame?: number | null;
  biasPct?: number | null;
  passes?: boolean;
  nSim?: number;
  nGame?: number;
}

export interface DashboardCaseLookupOptions {
  runId?: string;
  index?: number;
}

export function readDashboardComparison(path = "test_results/dashboard.sqlite"): DashboardComparison {
  const sqlitePath = resolveDashboardPath(path);
  if (!fileExists(sqlitePath)) return { dashboardAvailable: false };
  const rows = sqliteQuery(sqlitePath, "select id, finished_at, git_sha from runs order by finished_at desc limit 1;");
  if (rows.length === 0) return { dashboardAvailable: true };
  const [id, finishedAt, gitSha] = rows[0].split("\t");
  const fileRows = sqliteQuery(sqlitePath, `select count(*), coalesce(sum(included), 0) from run_testcase_files where run_id = ${sqlString(id)};`);
  const [testcaseFiles, includedTestcaseFiles] = (fileRows[0] ?? "0\t0").split("\t");
  return {
    dashboardAvailable: true,
    latestRun: {
      id,
      finishedAt,
      gitSha,
      testcaseFiles: Number(testcaseFiles) || 0,
      includedTestcaseFiles: Number(includedTestcaseFiles) || 0
    }
  };
}

export function readDashboardCase(
  path: string | undefined,
  file: string,
  testcaseId: string,
  options: DashboardCaseLookupOptions = {}
): DashboardCaseComparison | undefined {
  const sqlitePath = resolveDashboardPath(path ?? "test_results/dashboard.sqlite");
  if (!fileExists(sqlitePath)) return undefined;
  const runId = options.runId ?? readDashboardComparison(path).latestRun?.id;
  if (!runId) return undefined;
  const escapedFiles = testcaseFileLookupVariants(file).map(sqlString).join(", ");
  const escapedCase = sqlString(testcaseId);
  const indexClause = options.index === undefined ? "" : ` and idx = ${sqlInteger(options.index)}`;
  const rows = sqliteQuery(
    sqlitePath,
    `select run_id, idx, mu_sim, mu_game, bias_pct, passes, n_sim, n_game from run_testcases where run_id = ${sqlString(runId)} and file in (${escapedFiles}) and testcase_id = ${escapedCase}${indexClause} order by idx asc limit 1;`
  );
  if (rows.length === 0) return undefined;
  const [rowRunId, idx, muSim, muGame, biasPct, passes, nSim, nGame] = rows[0].split("\t");
  return {
    runId: rowRunId,
    idx: Number(idx) || 0,
    muSim: nullableNumber(muSim),
    muGame: nullableNumber(muGame),
    biasPct: nullableNumber(biasPct),
    passes: passes === "1",
    nSim: Number(nSim) || 0,
    nGame: Number(nGame) || 0
  };
}

export function testcaseFileLookupVariants(file: string): string[] {
  const normalized = file.replaceAll("\\", "/");
  const variants = new Set<string>([normalized]);
  const v3Index = normalized.indexOf("v3/testcases/");
  if (v3Index >= 0) variants.add(`testcases/${normalized.slice(v3Index + "v3/testcases/".length)}`);
  const testcaseIndex = normalized.indexOf("testcases/");
  if (testcaseIndex >= 0) {
    const sourcePath = normalized.slice(testcaseIndex);
    variants.add(sourcePath);
    variants.add(`v3/${sourcePath}`);
  }
  return [...variants];
}

function resolveDashboardPath(path: string): string {
  const direct = resolve(path);
  if (fileExists(direct)) return direct;
  if (!path.startsWith("/") && path.startsWith("test_results/")) {
    const parent = resolve("..", path);
    if (fileExists(parent)) return parent;
  }
  return direct;
}

function sqliteQuery(path: string, query: string): string[] {
  const result = spawnSync("sqlite3", ["-separator", "\t", path, query], { encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlInteger(value: number): number {
  return Math.max(0, Math.trunc(value));
}

function nullableNumber(value: string): number | null {
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
