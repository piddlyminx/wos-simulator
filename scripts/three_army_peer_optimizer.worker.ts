import {workerData} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {loadSimulatorConfig} from '../simulator/src/config-node';
import {evaluateOptimizationWorkerTask} from './three_army_optimizer';
import {installWorkerThreadBatchHandler} from './workerThreadBatchWorker';
import {aggregate} from './three_army_peer_panel';
const config=loadSimulatorConfig();
const panel=JSON.parse(readFileSync(workerData.panelPath,'utf8'));
installWorkerThreadBatchHandler<any,any>(tasks=>tasks.map(task=>{
 const opponents=task.opponent?[task.opponent]:panel;
 if(task.reps%(2*opponents.length)!==0)throw new Error('Budget must evenly cover opponents and roles');
 const results=[],reverse=[];
 for(let i=0;i<opponents.length;i++)for(let role=0;role<2;role++){
  const definition={attacker:role?opponents[i]:task.armies,defender:role?task.armies:opponents[i],ordering:'sequential' as const,max_rounds:workerData.maxRounds??1500,input_stats_include_hero_generation:{attacker:false,defender:false}};
  results.push(evaluateOptimizationWorkerTask({definition,heroes:[],side:'attacker',reps:task.reps/(2*opponents.length),seed:task.seed+7919*i},config));reverse.push(Boolean(role));
 }
 return aggregate(results,reverse);
}));
