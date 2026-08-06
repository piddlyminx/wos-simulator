import { loadSimulatorConfig } from "../../simulator/src/config-node";
import { installWorkerThreadBatchHandler } from "../workerThreadBatchWorker";
import { runSingleBattleDirect } from "./battleRunner";
import type { BattleSummary, BattleTask } from "./types";

const config = loadSimulatorConfig();

installWorkerThreadBatchHandler<BattleTask, BattleSummary>((tasks) => (
  tasks.map((task) => runSingleBattleDirect(task, config))
));
