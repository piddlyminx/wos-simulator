import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { cpus } from "node:os";
import { createInterface } from "node:readline";

import type { BattleSummary, BattleTask } from "./types.js";

interface WorkerResponse {
  id: number;
  result?: BattleSummary;
  error?: string;
}

interface PendingTask {
  task: BattleTask;
  resolve: (result: BattleSummary) => void;
  reject: (error: Error) => void;
}

interface WorkerState {
  process: ChildProcessWithoutNullStreams;
  idle: boolean;
  closed: boolean;
  stderr: string;
  inFlight?: {
    resolve: (result: BattleSummary) => void;
    reject: (error: Error) => void;
  };
}

export class TournamentWorkerPool {
  private readonly workers: WorkerState[];
  private readonly queue: PendingTask[] = [];
  private nextId = 1;

  constructor(size: number) {
    const count = Math.max(1, Math.floor(size || cpus().length || 1));
    this.workers = Array.from({ length: count }, () => this.startWorker());
  }

  run(task: BattleTask): Promise<BattleSummary> {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.pump();
    });
  }

  async close(): Promise<void> {
    await Promise.all(
      this.workers.map(
        (worker) =>
          new Promise<void>((resolve) => {
            if (worker.closed) {
              resolve();
              return;
            }
            worker.process.once("close", () => resolve());
            worker.process.stdin.end();
          })
      )
    );
  }

  private startWorker(): WorkerState {
    const child = spawn("npx", ["--yes", "tsx", "src/tournament/worker.ts"], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"]
    });
    const state: WorkerState = { process: child, idle: true, closed: false, stderr: "" };
    const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });
    stdout.on("line", (line) => this.handleResponse(state, line));
    child.stderr.on("data", (chunk) => {
      state.stderr += String(chunk);
    });
    child.on("close", (code) => {
      state.closed = true;
      state.idle = false;
      if (state.inFlight) {
        state.inFlight.reject(new Error(`Tournament worker exited with code ${code ?? "unknown"}${state.stderr ? `: ${state.stderr}` : ""}`));
        state.inFlight = undefined;
      }
      if (this.workers.every((item) => item.closed)) {
        while (this.queue.length > 0) this.queue.shift()!.reject(new Error("All tournament workers exited before completing queued tasks"));
      }
    });
    return state;
  }

  private handleResponse(state: WorkerState, line: string): void {
    const inFlight = state.inFlight;
    if (!inFlight) return;
    state.inFlight = undefined;
    state.idle = true;
    try {
      const response = JSON.parse(line) as WorkerResponse;
      if (response.error) inFlight.reject(new Error(response.error));
      else if (response.result) inFlight.resolve(response.result);
      else inFlight.reject(new Error(`Malformed tournament worker response for job ${response.id}`));
    } catch (error) {
      inFlight.reject(error instanceof Error ? error : new Error(String(error)));
    }
    this.pump();
  }

  private pump(): void {
    for (const state of this.workers) {
      if (!state.idle || state.closed) continue;
      const pending = this.queue.shift();
      if (!pending) return;
      const id = this.nextId;
      this.nextId += 1;
      state.idle = false;
      state.inFlight = { resolve: pending.resolve, reject: pending.reject };
      state.process.stdin.write(`${JSON.stringify({ id, task: pending.task })}\n`);
    }
  }
}
