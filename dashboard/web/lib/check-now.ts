import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export type CheckNowState = "idle" | "running" | "succeeded" | "failed";

export interface LatestRunSummary {
  id: string;
  started_at: string | null;
  finished_at: string | null;
  overall_avg_error_pct: number | null;
  bh_sig_count: number | null;
}

export interface CheckNowStatus {
  state: CheckNowState;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  matching?: string[];
  runner_pid?: number;
  exit_code?: number;
  error?: string;
  stdout_tail?: string;
  stderr_tail?: string;
  latest_run?: LatestRunSummary | null;
  command?: string[];
}

export const REPO_ROOT = path.resolve(process.cwd(), "../..");
const CHECK_NOW_RUNNER = path.join(REPO_ROOT, "dashboard", "check_now.py");
export const CHECK_NOW_STATUS_PATH = path.join(
  os.tmpdir(),
  "wos-dashboard-check-now-status.json",
);

function resolvePython(): string {
  if (process.env.SIMULATOR_PYTHON) return process.env.SIMULATOR_PYTHON;
  const venv = path.join(REPO_ROOT, ".venv", "bin", "python");
  if (fs.existsSync(venv)) return venv;
  return "python3";
}

function writeStatus(status: CheckNowStatus): void {
  const tmpPath = `${CHECK_NOW_STATUS_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(status, null, 2), "utf-8");
  fs.renameSync(tmpPath, CHECK_NOW_STATUS_PATH);
}

function isProcessAlive(pid: number | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function splitMatchingInput(input: string | undefined | null): string[] {
  if (!input) return [];
  return input
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function readStatusFile(): CheckNowStatus | null {
  if (!fs.existsSync(CHECK_NOW_STATUS_PATH)) return null;
  try {
    return JSON.parse(
      fs.readFileSync(CHECK_NOW_STATUS_PATH, "utf-8"),
    ) as CheckNowStatus;
  } catch {
    return {
      state: "failed",
      error: "Could not parse background check status.",
    };
  }
}

export function getCheckNowStatus(): CheckNowStatus {
  const status = readStatusFile();
  if (!status) return { state: "idle" };
  if (status.state !== "running") return status;
  if (isProcessAlive(status.runner_pid)) return status;

  const staleStatus: CheckNowStatus = {
    ...status,
    state: "failed",
    finished_at: status.finished_at ?? new Date().toISOString(),
    error:
      status.error ??
      "Background check runner exited unexpectedly before reporting a result.",
  };
  writeStatus(staleStatus);
  return staleStatus;
}

export function startCheckNow(matchingInput: string | undefined | null): CheckNowStatus {
  const current = getCheckNowStatus();
  if (current.state === "running") return current;

  if (!fs.existsSync(CHECK_NOW_RUNNER)) {
    throw new Error(`Check-now runner not found at ${CHECK_NOW_RUNNER}`);
  }

  const matching = splitMatchingInput(matchingInput);
  const startedAt = new Date().toISOString();
  const python = resolvePython();
  const args = [
    CHECK_NOW_RUNNER,
    "--status-file",
    CHECK_NOW_STATUS_PATH,
    ...(matching.length > 0 ? ["--matching", ...matching] : []),
  ];

  const child = spawn(python, args, {
    cwd: REPO_ROOT,
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  const initialStatus: CheckNowStatus = {
    state: "running",
    started_at: startedAt,
    matching,
    runner_pid: child.pid,
    command: [python, ...args],
  };
  writeStatus(initialStatus);
  return initialStatus;
}
