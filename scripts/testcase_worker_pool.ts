import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import type { TestcaseExecutionJob, TestcaseExecutionResult } from "../simulator/src/testcases";

interface WorkerResponse {
  id: number;
  result?: TestcaseExecutionResult;
  error?: string;
}

interface PendingJob {
  job: TestcaseExecutionJob;
  resolve: (result: TestcaseExecutionResult) => void;
  reject: (error: Error) => void;
}

interface InFlightJob {
  resolve: (result: TestcaseExecutionResult) => void;
  reject: (error: Error) => void;
}

interface WorkerState {
  process: ChildProcessWithoutNullStreams;
  idle: boolean;
  closed: boolean;
  stderr: string;
  inFlight?: InFlightJob;
}

const WORKER_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "testcase_worker.ts");

export class TestcaseWorkerPool {
  private readonly workers: WorkerState[];
  private readonly queue: PendingJob[] = [];
  private nextId = 1;

  constructor(size: number) {
    const count = Math.max(1, Math.floor(size));
    this.workers = Array.from({ length: count }, () => this.startWorker());
  }

  run(job: TestcaseExecutionJob): Promise<TestcaseExecutionResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({ job, resolve, reject });
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
    const child = spawn("npx", ["--yes", "tsx", WORKER_SCRIPT], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"]
    });
    const worker: WorkerState = { process: child, idle: true, closed: false, stderr: "" };
    const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });
    stdout.on("line", (line) => this.handleResponse(worker, line));
    child.stderr.on("data", (chunk) => {
      worker.stderr += String(chunk);
    });
    child.on("close", (code) => {
      worker.closed = true;
      worker.idle = false;
      if (worker.inFlight) {
        worker.inFlight.reject(new Error(`Testcase worker exited with code ${code ?? "unknown"}${worker.stderr ? `: ${worker.stderr}` : ""}`));
        worker.inFlight = undefined;
      }
      if (this.workers.every((item) => item.closed)) {
        while (this.queue.length > 0) this.queue.shift()!.reject(new Error("All testcase workers exited before completing queued jobs"));
      }
    });
    return worker;
  }

  private handleResponse(worker: WorkerState, line: string): void {
    if (!worker.inFlight) return;
    const inFlight = worker.inFlight;
    worker.inFlight = undefined;
    worker.idle = true;
    try {
      const response = JSON.parse(line) as WorkerResponse;
      if (response.error) inFlight.reject(new Error(response.error));
      else if (response.result) inFlight.resolve(response.result);
      else inFlight.reject(new Error(`Malformed testcase worker response for job ${response.id}`));
    } catch (error) {
      inFlight.reject(error instanceof Error ? error : new Error(String(error)));
    }
    this.pump();
  }

  private pump(): void {
    for (const worker of this.workers) {
      if (!worker.idle || worker.closed) continue;
      const pending = this.queue.shift();
      if (!pending) return;
      const id = this.nextId++;
      worker.idle = false;
      worker.inFlight = { resolve: pending.resolve, reject: pending.reject };
      worker.process.stdin.write(`${JSON.stringify({ id, job: pending.job })}\n`);
    }
  }
}
