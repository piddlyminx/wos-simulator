import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {compareOutcomeDistribution} from '../../../../simulator/src/tooling/parityMetrics';
const dir=dirname(fileURLToPath(import.meta.url)),root=resolve(dir,'../../../..');
const read=(file:string)=>JSON.parse(readFileSync(resolve(dir,file),'utf8'));
const hash=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
const protocol=read('protocol.json'),config=read('config.json'),cases=read('cases.json'),patches=read('patches.json');
const output=resolve(process.argv[2]??join(dir,'results.json'));assert(!existsSync(output));
for(const[path,digest]of Object.entries(protocol.artifacts))assert.equal(hash(readFileSync(resolve(dir,path))),digest);
for(const[path,digest]of Object.entries(protocol.tooltipHashes))assert.equal(hash(readFileSync(resolve(root,path))),digest);
const original:Record<string,string>={};
for(const[path,digest]of Object.entries(protocol.sourceHashes)){original[path]=readFileSync(resolve(root,path),'utf8');assert.equal(hash(original[path]),digest);}
const temp=mkdtempSync(join(tmpdir(),'gwen-tooltip-scope-'));
async function runtime(name:string,modified:boolean){const texts={...original};if(modified)for(const patch of patches){assert.equal(texts[patch.file].split(patch.from).length,2,patch.file);texts[patch.file]=texts[patch.file].replace(patch.from,patch.to);}for(const[path,text]of Object.entries(texts)){const target=join(temp,name,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,text);}return {engine:await import(pathToFileURL(join(temp,name,'simulator/src/simulator.ts')).href),hashes:Object.fromEntries(Object.entries(texts).map(([path,text])=>[path,hash(text)]))};}
try{
 const plain=await runtime('plain',false),snapshot=await runtime('snapshot',true);const results=[];
 for(const test of cases){const predictions:any={};for(const[schedule,timing]of Object.entries(protocol.schedules))for(const model of Object.keys(protocol.models)){
  const variant=structuredClone(config),g=variant.heroDefinitions.Gwen.skills;Object.assign(g.Blastmaster.trigger,timing);
  if(model==='persistent_s1'){g.EagleVision.trigger={type:'battle_start'};delete g.EagleVision.effects['EagleVision/1'].duration;}
  if(model==='normal_augmentation')for(const skill of ['AirDominance','Blastmaster'])for(const job of g[skill].effects[`${skill}/1`].trigger_damage_jobs)job.damage_kind='normal';
  const engine=(model==='normal_snapshot'||model==='normal_augmentation'?snapshot:plain).engine,prepared=engine.prepareBattle(test.input,variant);
  const samples:number[]=[],details:any[]=[];let first:any;
  for(let n=0;n<(test.deterministic?1:1000);n++){
   const r=engine.runPrepared(prepared,`gwen-tooltip-scope-${n}`,{mode:n===0?'trace':'fast'});if(n===0)first=r;
   assert.equal(r.randomness.deterministic,test.deterministic);const a=Object.values(r.remaining.attacker).reduce((sum:number,x:any)=>sum+x,0),d=Object.values(r.remaining.defender).reduce((sum:number,x:any)=>sum+x,0);samples.push(a-d);
   details.push({attacker:a,defender:d,rounds:r.rounds,winner:r.winner});
  }
  const observations=Array.isArray(test.game)?test.game:[test.game],game=observations.map((x:any)=>x.attacker-x.defender),initialTroops=['attacker','defender'].reduce((sum,side)=>sum+Object.values(test.input[side].troops).reduce((s:number,n:any)=>s+n,0),0);
  if(test.deterministic&&model==='per_job'&&schedule==='production')assert.equal(samples[0],test.productionMean,'Production endpoint drift');
  const jobs=first.attacks.map((a:any)=>({round:a.round,kind:a.kind,effect:a.sourceEffectId??'normal',dealerSide:a.dealerSide,source:a.dealerUnit,target:a.takerUnit,kills:a.kills,modifiers:(a.appliedEffects??[]).filter((e:any)=>['EagleVision/1','AirDominance/2'].includes(e.effectId)).map((e:any)=>({effect:e.effectId,value:e.valuePct}))}));
  predictions[`${schedule}/${model}`]={samples,details,comparison:compareOutcomeDistribution({candidate:{samples},reference:{samples:game},initialTroops,deterministic:test.deterministic}),remaining:first.remaining,rounds:first.rounds,heroReport:first.skillReport,jobs};
 }
 results.push({...test,predictions});console.log(JSON.stringify({key:test.key,game:test.game,predictions:Object.fromEntries(Object.entries(predictions).map(([name,r]:any)=>[name,{mean:r.comparison.mu_candidate,p:r.comparison.p,remaining:r.remaining,rounds:r.rounds}]))}));}
 for(const[path,digest]of Object.entries(protocol.sourceHashes))assert.equal(hash(readFileSync(resolve(root,path))),digest);
 writeFileSync(output,JSON.stringify({generatedAt:new Date().toISOString(),protocol,patches,runtimeHashes:{plain:plain.hashes,snapshot:snapshot.hashes},results},null,2)+'\n',{flag:'wx'});
}finally{rmSync(temp,{recursive:true,force:true});}
