import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileExists } from "./config.js";

export interface DashboardComparison {
  dashboardAvailable: boolean;
  latestRun?: { id: string; finishedAt: string; gitSha: string; testcaseFiles?: number; includedTestcaseFiles?: number };
}

export interface DashboardCaseComparison {
  runId?: string;
  muSim?: number | null;
  muGame?: number | null;
  biasPct?: number | null;
  passes?: boolean;
  nSim?: number;
  nGame?: number;
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

export function readDashboardCase(path: string | undefined, file: string, testcaseId: string): DashboardCaseComparison | undefined {
  const sqlitePath = resolveDashboardPath(path ?? "test_results/dashboard.sqlite");
  if (!fileExists(sqlitePath)) return undefined;
  const escapedFile = sqlString(file);
  const escapedCase = sqlString(testcaseId);
  const rows = sqliteQuery(
    sqlitePath,
    `select run_id, mu_sim, mu_game, bias_pct, passes, n_sim, n_game from run_testcases where file = ${escapedFile} and testcase_id = ${escapedCase} order by id desc limit 1;`
  );
  if (rows.length === 0) return undefined;
  const [runId, muSim, muGame, biasPct, passes, nSim, nGame] = rows[0].split("\t");
  return {
    runId,
    muSim: nullableNumber(muSim),
    muGame: nullableNumber(muGame),
    biasPct: nullableNumber(biasPct),
    passes: passes === "1",
    nSim: Number(nSim) || 0,
    nGame: Number(nGame) || 0
  };
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

function nullableNumber(value: string): number | null {
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
