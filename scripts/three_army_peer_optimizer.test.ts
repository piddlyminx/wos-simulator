import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,mkdtempSync,writeFileSync,rmSync,symlinkSync,mkdirSync,readdirSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadSimulatorConfig} from '../simulator/src/config-node';
import {createSearchModel,definitionForLoadout} from './three_army_loadout_optimizer';
import {buildOpponentPanel,aggregate} from './three_army_peer_panel';
import {BatchWorkerPool} from '../simulator/src/workerPool';
import {WorkerThreadBatchWorker} from './workerThreadBatchWorker';
import type {OptimizationResult} from './three_army_optimizer';
import {roundRobin,score} from './three_army_swiss';
const config=loadSimulatorConfig();
const raw=JSON.parse(readFileSync(new URL('three_army_optimizer.example.json',import.meta.url),'utf8'));
delete raw.optimization;raw.max_rounds=20;
raw.attacker.armies.forEach((a:any,i:number)=>{
 a.fighter.heroes=structuredClone(raw.defender.armies[i].fighter.heroes);
 for(const levels of Object.values(a.fighter.heroes) as Record<string,number>[])levels.skill_4=0;
 a.fighter.stats=Object.fromEntries(['infantry','lancer','marksman'].map(t=>[t,{attack:100+i*10,defense:100+i*10,lethality:100+i*10,health:100+i*10}]));
});
const model=createSearchModel(raw,config);
test('panel uses only supplied legal lineups, keeps six opponents and exact capacities',()=>{
 const panel=buildOpponentPanel(model,[model.initial.heroes]);
 assert.equal(panel.length,6);
 for(const s of panel){
  assert.deepEqual(s.heroes,model.initial.heroes);
  for(let i=0;i<3;i++)assert.equal(s.troops[i].reduce((a,b)=>a+b,0),model.initial.troops[i].reduce((a,b)=>a+b,0));
  for(const type of ['infantry','lancer','marksman'] as const)assert.deepEqual([...s.gear[type]].sort(),[0,1,2]);
 }
 assert.deepEqual(panel,buildOpponentPanel(model,[model.initial.heroes]));
 assert.equal(new Set(panel.map(s=>JSON.stringify(s.troops))).size,6);
});
test('panel responds to changed heroes and includes supplied distant alternatives',()=>{
 const swapped=model.initial.heroes.map((_,i)=>model.initial.heroes[(i+1)%3]) as typeof model.initial.heroes;
 const panel=buildOpponentPanel(model,[model.initial.heroes,swapped]);
 assert.deepEqual(panel[0].heroes,model.initial.heroes);assert.deepEqual(panel[1].heroes,swapped);
 assert.deepEqual(buildOpponentPanel(model,[swapped])[0].heroes,swapped);
});
test('balanced worker scoring cancels role advantage in identical-team matches',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'peer-optimizer-'));
 const armies=definitionForLoadout(model,model.initial)[model.side];
 const panelPath=join(dir,'panel.json');writeFileSync(panelPath,JSON.stringify([armies]));
 const pool=new BatchWorkerPool<any,any>(2,()=>new WorkerThreadBatchWorker(new URL('three_army_peer_optimizer.worker.ts',import.meta.url),{workerData:{panelPath,maxRounds:model.definition.max_rounds}}));
 try{
  const task={armies,reps:12,seed:42};const [a,b]=await Promise.all([pool.runTask(task),pool.runTask(task)]);
  assert.deepEqual(a,b);assert.equal(a.evaluation.scenarios,12);
  assert.equal(a.evaluation.attackerWins,a.evaluation.defenderWins);
  assert.equal(a.averageMargin,0);assert.equal(a.scoreRate,.5);
 }finally{await pool.close();rmSync(dir,{recursive:true,force:true});}
});

test('pooled sample deviation matches directly concatenated margins with reversed battle roles',()=>{
 const result=(margins:number[]):OptimizationResult=>{
  const n=margins.length,mean=margins.reduce((a,b)=>a+b,0)/n;
  const w=margins.filter(m=>m>0).length,l=margins.filter(m=>m<0).length,d=n-w-l;
  return {rank:0,heroes:[],winRate:w/n,scoreRate:(w+d/2)/n,averageMargin:mean,evaluation:{
   scenarios:n,attackerWins:w,defenderWins:l,draws:d,attackerWinRate:w/n,defenderWinRate:l/n,
   averageAttackerRemaining:100+mean,averageDefenderRemaining:100,averageAttackerMargin:mean,
   attackerMarginStd:n>1?Math.sqrt(margins.reduce((s,m)=>s+(m-mean)**2,0)/(n-1)):0,averageBattles:3}};
 };
 const a=result([2,4,6]),b=result([-1,3]),c=result([7]);
 const pooled=aggregate([a,b,c],[false,true,false]),expected=result([2,4,6,1,-3,7]);
 assert.equal(pooled.evaluation.scenarios,6);
 assert.equal(pooled.evaluation.attackerWins,5);assert.equal(pooled.evaluation.defenderWins,1);
 assert.equal(pooled.scoreRate,5/6);
 assert.ok(Math.abs(pooled.averageMargin-expected.averageMargin)<1e-12);
 assert.ok(Math.abs(pooled.evaluation.attackerMarginStd-expected.evaluation.attackerMarginStd)<1e-12);
 assert.equal(aggregate([c],[false]).evaluation.attackerMarginStd,0);
});

test('a singleton peer round robin has neutral no-games score and finite margin',async()=>{
 const result=await roundRobin([model.initial],200,1,1,async()=>{throw new Error('A singleton cannot play a pair')});
 assert.equal(result.pairs.length,0);assert.equal(result.standings[0].games,0);
 assert.equal(score(result.standings[0]),.5);assert.equal(result.standings[0].marginTotal,0);
});

test('peer CLI refuses existing artifact directories, directory links and reserved winner filenames before any writes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'peer-artifact-safety-'));
 const cli=fileURLToPath(new URL('three_army_peer_optimizer.ts',import.meta.url));
 const tsx=fileURLToPath(new URL('../simulator/node_modules/.bin/tsx',import.meta.url));
 try{
  const input=join(dir,'input.json'),contents=JSON.stringify(raw);writeFileSync(input,contents);
  const link=join(dir,'alias');symlinkSync(dir,link,'dir');
  const empty=join(dir,'empty');mkdirSync(empty);
  for(const output of [join(dir,'winner.json'),join(link,'winner.json'),join(empty,'winner.json'),join(dir,'new','input.json')]){
   const run=spawnSync(tsx,[cli,input,'--output',output],{encoding:'utf8'});
   assert.equal(run.status,1,run.stderr);
   assert.match(run.stderr,/fresh output directory|reserved for a run artifact/);
   assert.equal(readFileSync(input,'utf8'),contents);
  }
  assert.deepEqual(readdirSync(empty),[]);assert.equal(existsSync(join(dir,'new')),false);
  assert.deepEqual(readdirSync(dir).sort(),['alias','empty','input.json']);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
