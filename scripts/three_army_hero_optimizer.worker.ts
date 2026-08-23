import { workerData } from "node:worker_threads";

import { loadSimulatorConfig } from "../simulator/src/config-node";
import {
  evaluateHeroOptimizationWorkerTask,
  type HeroOptimizationWorkerContext,
  type HeroOptimizationWorkerTask,
  type OptimizationResult
} from "./three_army_optimizer";
import { installWorkerThreadBatchHandler } from "./workerThreadBatchWorker";

const simulatorConfig = loadSimulatorConfig();
const context = workerData as HeroOptimizationWorkerContext;

installWorkerThreadBatchHandler<HeroOptimizationWorkerTask, OptimizationResult>((tasks) =>
  tasks.map((task) => evaluateHeroOptimizationWorkerTask(context, task, simulatorConfig))
);
