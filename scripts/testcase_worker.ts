import { createInterface } from "node:readline";

import { loadSimulatorConfig } from "../simulator/src/config";
import { executeTestcaseCase, type TestcaseExecutionJob } from "../simulator/src/testcases";

interface WorkerRequest {
  id: number;
  job: TestcaseExecutionJob;
}

const config = loadSimulatorConfig();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

input.on("line", (line) => {
  if (!line.trim()) return;
  const request = JSON.parse(line) as WorkerRequest;
  const result = executeTestcaseCase(request.job, config);
  process.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
});
