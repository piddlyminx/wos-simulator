import { createRequire } from "node:module";
import { parentPort, Worker, type WorkerOptions } from "node:worker_threads";

import type {
  BatchWorker,
  BatchWorkerRequest,
  BatchWorkerResponse,
} from "../simulator/src/workerPool";

type RunBatch<TTask, TResult, TProgress> = (
  tasks: TTask[],
  onProgress: (progress: TProgress) => void,
) => Promise<TResult[]> | TResult[];

export class WorkerThreadBatchWorker<TTask, TResult, TProgress = never>
implements BatchWorker<TTask, TResult, TProgress> {
  private readonly worker: Worker;
  private rejectInFlight?: (error: Error) => void;

  constructor(url: URL, options: Omit<WorkerOptions, "execArgv"> & { execArgv?: string[] } = {}) {
    this.worker = new Worker(url, {
      ...options,
      execArgv: [...(options.execArgv ?? []), "--import", resolveTsxLoader()],
    });
  }

  runBatch(
    id: number,
    tasks: TTask[],
    onProgress?: (progress: TProgress) => void,
  ): Promise<TResult[]> {
    if (this.rejectInFlight) return Promise.reject(new Error("Worker thread already has an in-flight batch"));
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.rejectInFlight = undefined;
        this.worker.off("message", onMessage);
        this.worker.off("error", onError);
        this.worker.off("exit", onExit);
      };
      const onMessage = (message: unknown) => {
        const response = message as BatchWorkerResponse<TResult, TProgress>;
        if (response.id !== id) return;
        if (response.type === "progress") {
          onProgress?.(response.progress);
          return;
        }
        cleanup();
        if (response.type === "result") resolve(response.results);
        else reject(new Error(response.error));
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onExit = (code: number) => {
        cleanup();
        reject(new Error(`Worker thread exited with code ${code}`));
      };
      this.rejectInFlight = reject;
      this.worker.on("message", onMessage);
      this.worker.once("error", onError);
      this.worker.once("exit", onExit);
      this.worker.postMessage({ id, tasks } satisfies BatchWorkerRequest<TTask>);
    });
  }

  async close(): Promise<void> {
    if (this.rejectInFlight) {
      this.rejectInFlight(new Error("Worker thread closed before completing in-flight batch"));
      this.rejectInFlight = undefined;
    }
    await this.worker.terminate();
  }
}

export function installWorkerThreadBatchHandler<TTask, TResult, TProgress = never>(
  runBatch: RunBatch<TTask, TResult, TProgress>,
): void {
  const port = parentPort;
  if (!port) throw new Error("Worker thread batch handler requires a parent port");
  port.on("message", (request: BatchWorkerRequest<TTask>) => {
    void Promise.resolve(runBatch(
      request.tasks,
      (progress) => port.postMessage({
        id: request.id,
        type: "progress",
        progress,
      } satisfies BatchWorkerResponse<TResult, TProgress>),
    )).then(
      (results) => port.postMessage({
        id: request.id,
        type: "result",
        results,
      } satisfies BatchWorkerResponse<TResult, TProgress>),
      (error) => port.postMessage({
        id: request.id,
        type: "error",
        error: error instanceof Error ? error.message : String(error),
      } satisfies BatchWorkerResponse<TResult, TProgress>),
    );
  });
}

function resolveTsxLoader(): string {
  const requireFromSimulator = createRequire(new URL("../simulator/package.json", import.meta.url));
  return requireFromSimulator.resolve("tsx");
}
