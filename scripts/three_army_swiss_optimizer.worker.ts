import {loadSimulatorConfig} from '../simulator/src/config-node';
import {evaluateOptimizationWorkerTask,type ArmyDefinition} from './three_army_optimizer';
import {installWorkerThreadBatchHandler} from './workerThreadBatchWorker';
import type {PairResult} from './three_army_swiss';
export interface PairTask {left:[ArmyDefinition,ArmyDefinition,ArmyDefinition];right:[ArmyDefinition,ArmyDefinition,ArmyDefinition];reps:number;seed:number;maxRounds?:number}
const config=loadSimulatorConfig();
installWorkerThreadBatchHandler<PairTask,PairResult>(tasks=>tasks.map(t=>{
  if(t.reps<2||t.reps%2)throw new Error('Pair budget must be a positive even number');
  const evaluations=[false,true].map(reverse=>evaluateOptimizationWorkerTask({
    definition:{attacker:reverse?t.right:t.left,defender:reverse?t.left:t.right,ordering:'sequential',max_rounds:t.maxRounds??1500,input_stats_include_hero_generation:{attacker:false,defender:false}},
    side:'attacker',heroes:[],reps:t.reps/2,seed:t.seed
  },config).evaluation);
  const [a,b]=evaluations;
  return {matches:t.reps,leftWins:a.attackerWins+b.defenderWins,rightWins:a.defenderWins+b.attackerWins,draws:a.draws+b.draws,margin:(a.averageAttackerMargin-b.averageAttackerMargin)/2};
}));
