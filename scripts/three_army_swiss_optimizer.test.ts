import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,mkdtempSync,writeFileSync,rmSync,symlinkSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadSimulatorConfig} from '../simulator/src/config-node';
import {createSearchModel,definitionForLoadout,type Loadout} from './three_army_loadout_optimizer';
import {swiss,roundRobin,standings,pairRound,score,loadoutKey,uniqueLoadouts,type PlayPair} from './three_army_swiss';
import {parseArgs,main,compatibleBenchmark} from './three_army_swiss_optimizer';
import {BatchWorkerPool} from '../simulator/src/workerPool';
import {WorkerThreadBatchWorker} from './workerThreadBatchWorker';
import type {PairTask} from './three_army_swiss_optimizer.worker';
import type {PairResult} from './three_army_swiss';
const fake=(n:number):Loadout=>({heroes:[[],[],[]],gear:{infantry:[0,1,2],lancer:[0,1,2],marksman:[0,1,2]},troops:[[n,100-n,0],[50,50,0],[50,50,0]]});
const fitness:PlayPair=async(a,b,reps)=>({matches:reps,leftWins:a.troops[0][0]>b.troops[0][0]?reps:0,rightWins:a.troops[0][0]<b.troops[0][0]?reps:0,draws:a.troops[0][0]===b.troops[0][0]?reps:0,margin:a.troops[0][0]-b.troops[0][0]});
const config=loadSimulatorConfig();
function input(){
 const raw=JSON.parse(readFileSync(new URL('three_army_optimizer.example.json',import.meta.url),'utf8'));
 raw.max_rounds=20;
 raw.attacker.armies.forEach((a:any,i:number)=>{
  a.fighter.heroes=structuredClone(raw.defender.armies[i].fighter.heroes);
  for(const levels of Object.values(a.fighter.heroes) as Record<string,number>[])levels.skill_4=0;
  a.fighter.stats=Object.fromEntries(['infantry','lancer','marksman'].map(t=>[t,{attack:100+i*10,defense:100+i*10,lethality:100+i*10,health:100+i*10}]));
 });
 return raw;
}
test('Swiss plays broad candidates before freezing and keeps the strongest candidate',async()=>{
 const states=Array.from({length:80},(_,i)=>fake(i));
 const result=await swiss(states,{rounds:14,reps:2,jobs:4,seed:7,freezeAfter:6,keep:16},fitness);
 assert.equal(result[0].loadout.troops[0][0],79);
 assert.ok(result.every(s=>s.games>=16));
 assert.ok(result.some(s=>s.frozen));assert.ok(result.filter(s=>!s.frozen).length>=16);
 assert.equal(result.reduce((n,s)=>n+s.wins,0),result.reduce((n,s)=>n+s.losses,0));
 assert.equal(result.reduce((n,s)=>n+s.marginTotal,0),0);
 const serial=await swiss(states,{rounds:14,reps:2,jobs:1,seed:7,freezeAfter:6,keep:16},fitness);
 assert.deepEqual(result,serial);
});
test('ranked rounds avoid previous opponents when alternatives are available',()=>{
 const rows=standings(Array.from({length:10},(_,i)=>fake(i)));
 const first=pairRound(rows,3,1);
 for(const [a,b] of first.pairs){a.opponents.push(b.id);b.opponents.push(a.id)}
 const second=pairRound(rows,4,1);assert.ok(second.pairs.every(([a,b])=>!a.opponents.includes(b.id)));
});
test('odd fields rotate byes without inventing wins or games',()=>{
 const rows=standings(Array.from({length:5},(_,i)=>fake(i)));
 const byes=[];
 for(let round=0;round<5;round++){
  const result=pairRound(rows,round,9);assert.equal(result.pairs.length,2);byes.push(result.bye!.id);
  assert.equal(new Set(result.pairs.flat().map(s=>s.id)).size,4);
 }
 assert.equal(new Set(byes).size,5);assert.ok(rows.every(s=>s.games===0&&s.wins===0));
});
test('round robin accounts for draws and opposite margins with equal games',async()=>{
 const result=await roundRobin([fake(1),fake(2),fake(3)],20,3,9,fitness);
 assert.equal(result.pairs.length,3);assert.ok(result.standings.every(s=>s.games===40));
 assert.equal(score(result.standings[0]),1);assert.equal(result.standings[0].loadout.troops[0][0],3);
 assert.equal(result.standings.reduce((n,s)=>n+s.marginTotal,0),0);
});
test('draw points remain complementary between both sides',async()=>{
 const play:PlayPair=async()=>({matches:20,leftWins:3,rightWins:5,draws:12,margin:-2});
 const result=await roundRobin([fake(1),fake(2),fake(3)],20,2,9,play);
 assert.equal(result.standings.reduce((n,s)=>n+s.draws,0),72);
 assert.equal(result.standings.reduce((n,s)=>n+s.wins+s.draws/2,0),60);
 assert.equal(result.standings.reduce((n,s)=>n+s.marginTotal,0),0);
 assert.ok(result.standings.every(s=>s.wins+s.losses+s.draws===s.games));
});
test('canonical identity recognizes hero array and dictionary representations',()=>{
 const a=fake(1);a.heroes[0]=[{name:'Edith',levels:{skill_1:5,skill_2:5,skill_3:5}}];
 const b={...a,heroes:[{Edith:{skill_3:5,skill_2:5,skill_1:5,skill_4:0}},[],[]] as Loadout['heroes']};
 assert.equal(loadoutKey(a),loadoutKey(b));assert.equal(uniqueLoadouts([a,b]).length,1);
});
test('CLI rejects odd budgets and supports reusable external benchmarks',()=>{
 const o=parseArgs(['input.json','--benchmark','old.json','--passes','1']);
 assert.deepEqual(o.benchmarks,['old.json']);assert.equal(o.passes,1);
 assert.throws(()=>parseArgs(['input.json','--final-reps','99']),/even/);
});
test('actual balanced pair evaluation cancels role advantage and is reproducible across workers',async()=>{
 const raw=input();
 const model=createSearchModel(raw,config),armies=definitionForLoadout(model,model.initial)[model.side];
 const pool=new BatchWorkerPool<PairTask,PairResult>(2,()=>new WorkerThreadBatchWorker(new URL('three_army_swiss_optimizer.worker.ts',import.meta.url)));
 try{
  const t={left:armies,right:armies,reps:12,seed:8,maxRounds:model.definition.max_rounds};const [a,b]=await Promise.all([pool.runTask(t),pool.runTask(t)]);
  assert.deepEqual(a,b);assert.equal(a.matches,12);assert.equal(a.leftWins,a.rightWins);assert.equal(a.margin,0);
  assert.equal(a.matches,a.leftWins+a.rightWins+a.draws);
 }finally{await pool.close()}
});

test('benchmark hero skills must match the current optimization scope, including fixed heroes',()=>{
 const raw=input(),model=createSearchModel(raw,config);
 assert.deepEqual(compatibleBenchmark(model,createSearchModel(raw,config),config,'benchmark'),model.initial);
 const changed=input();changed.attacker.armies[0].fighter.heroes.Gatot.skill_1=4;
 assert.throws(()=>compatibleBenchmark(model,createSearchModel(changed,config),config,'benchmark'),/incompatible skill levels/);
 const outOfPool=input();outOfPool.attacker.armies[0].fighter.heroes.Magnus=outOfPool.attacker.armies[0].fighter.heroes.Gatot;
 delete outOfPool.attacker.armies[0].fighter.heroes.Gatot;
 assert.throws(()=>compatibleBenchmark(model,createSearchModel(outOfPool,config),config,'benchmark'),/not available/);
 delete raw.optimization;const fixed=createSearchModel(raw,config);
 const swapped=structuredClone(raw);
 [swapped.attacker.armies[0].fighter.heroes,swapped.attacker.armies[1].fighter.heroes]=[swapped.attacker.armies[1].fighter.heroes,swapped.attacker.armies[0].fighter.heroes];
 assert.throws(()=>compatibleBenchmark(fixed,createSearchModel(swapped,config),config,'benchmark'),/different fixed heroes/);
 assert.throws(()=>compatibleBenchmark(fixed,createSearchModel(changed,config),config,'benchmark'),/different fixed heroes or skill levels/);
 const fewer=structuredClone(raw);delete fewer.attacker.armies[0].fighter.heroes.Gatot;
 assert.throws(()=>compatibleBenchmark(model,createSearchModel(fewer,config),config,'benchmark'),/one hero of each troop type/);
});

test('benchmark compatibility accepts equivalent hero representations and rejects lost passives',()=>{
 const raw=input(),model=createSearchModel(raw,config),alias=input();
 alias.attacker.armies[0].fighter.heroes=Object.entries(alias.attacker.armies[0].fighter.heroes).map(([name,levels])=>({name:name.toLowerCase(),levels}));
 const accepted=compatibleBenchmark(model,createSearchModel(alias,config),config,'benchmark');
 assert.deepEqual(accepted.heroes[0],alias.attacker.armies[0].fighter.heroes);
 const passive=input();passive.attacker.passive.own.attack.up++;
 assert.throws(()=>compatibleBenchmark(model,createSearchModel(passive,config),config,'benchmark'),/different march passives/);
});

test('Swiss rejects output directories containing inputs or benchmark artifacts, including directory aliases',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'swiss-artifact-safety-'));
 try{
  const source=join(dir,'source.json'),benchmark=join(dir,'input.json'),contents=JSON.stringify(input());
  writeFileSync(source,contents);writeFileSync(benchmark,contents);
  const link=join(dir,'alias');symlinkSync(dir,link,'dir');
  for(const output of [join(dir,'winner.json'),join(link,'winner.json')]){
   await assert.rejects(main([source,'--benchmark',benchmark,'--output',output]),/fresh output directory/);
   assert.equal(readFileSync(source,'utf8'),contents);assert.equal(readFileSync(benchmark,'utf8'),contents);
  }
  await assert.rejects(main([source,'--output',join(dir,'new','stage_1.json')]),/reserved for a run artifact/);
  assert.equal(existsSync(join(dir,'new')),false);
  assert.deepEqual(readdirSync(dir).sort(),['alias','input.json','source.json']);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
