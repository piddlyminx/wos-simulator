import { loadSimulatorConfig } from "../simulator/src/config-node";
import { evaluateOptimizationWorkerTask, type OptimizationResult, type OptimizationWorkerTask } from "./three_army_optimizer";
import { installWorkerThreadBatchHandler } from "./workerThreadBatchWorker";

const simulatorConfig = loadSimulatorConfig();

installWorkerThreadBatchHandler<OptimizationWorkerTask, OptimizationResult>((tasks) =>
  tasks.map((task) => evaluateOptimizationWorkerTask(task, simulatorConfig))
);
