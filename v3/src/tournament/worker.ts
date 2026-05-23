import { createInterface } from "node:readline";
import { parentPort } from "node:worker_threads";

import { loadSimulatorConfig } from "../config.js";
import { runSingleBattleDirect } from "./battleRunner.js";
import type { BattleTask } from "./types.js";

interface WorkerRequest {
  id: number;
  task: BattleTask;
}

const config = loadSimulatorConfig();

function handleRequest(request: WorkerRequest): void {
  try {
    const result = runSingleBattleDirect(request.task, config);
    if (parentPort) parentPort.postMessage({ id: request.id, result });
    else process.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
  } catch (error) {
    const message = { id: request.id, error: error instanceof Error ? error.message : String(error) };
    if (parentPort) parentPort.postMessage(message);
    else process.stdout.write(`${JSON.stringify(message)}\n`);
  }
}

if (parentPort) {
  parentPort.on("message", (request: unknown) => handleRequest(request as WorkerRequest));
} else {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    if (!line.trim()) return;
    handleRequest(JSON.parse(line) as WorkerRequest);
  });
}
