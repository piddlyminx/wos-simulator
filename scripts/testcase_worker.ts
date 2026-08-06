import { loadSimulatorConfig } from "../simulator/src/config-node";
import {
  executeTestcaseCase,
  type TestcaseExecutionJob,
  type TestcaseExecutionResult,
} from "../simulator/src/tooling/testcases";
import { installWorkerThreadBatchHandler } from "./workerThreadBatchWorker";

const config = loadSimulatorConfig();

installWorkerThreadBatchHandler<TestcaseExecutionJob, TestcaseExecutionResult>((jobs) => (
  jobs.map((job) => executeTestcaseCase(job, config))
));
