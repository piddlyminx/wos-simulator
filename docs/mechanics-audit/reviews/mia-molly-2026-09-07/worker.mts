import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareBattle,runPrepared} from '../../../../simulator/src/simulator';
import {compareOutcomeDistribution} from '../../../../simulator/src/tooling/parityMetrics';
const dir=dirname(fileURLToPath(import.meta.url)),root=resolve(dir,'../../../..'),id=process.argv[2];
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const read=(path:string)=>JSON.parse(readFileSync(resolve(dir,path),'utf8'));
const protocol=read('protocol.json'),cases=read('cases.json'),base=read('config.json');
const selected=protocol.selections.find((s:any)=>s.id===id);assert(selected,`Unknown skill ${id}`);
const suffix=process.argv[3]??'initial',repeat=Number(process.argv[4]??1000),output=resolve(dir,`${id}-${suffix}.json`),rawOutput=resolve(dir,`${id}-${suffix}-samples.json`);assert(!existsSync(output)&&!existsSync(rawOutput));
for(const[path,digest]of Object.entries(protocol.artifacts))assert.equal(hash(readFileSync(resolve(dir,path))),digest,path);
for(const[path,digest]of Object.entries(protocol.sourceHashes))assert.equal(hash(readFileSync(resolve(root,path))),digest,path);
const variants:Record<string,any>={current:base,omit:structuredClone(base),lancer_only:structuredClone(base)};
variants.omit.heroDefinitions[selected.hero].skills[id].effects={};
const restricted=variants.lancer_only.heroDefinitions[selected.hero].skills[id];
if(restricted.trigger.type==='attack')restricted.trigger.source='lancer';else for(const effect of Object.values(restricted.effects)as any[])effect.units={...effect.units,applies_to:'lancer'};
const raw:any={sampleColumns:['attacker','defender','rounds','attackerInfantry','attackerLancer','attackerMarksman','defenderInfantry','defenderLancer','defenderMarksman'],cases:{}};const results=[];
for(const key of selected.coverage.fixture_keys){const test=cases[key],predictions:any={};raw.cases[key]={};const observations=Array.isArray(test.game)?test.game:[test.game],gameScores=observations.map((o:any)=>o.attacker-o.defender),initial=Object.fromEntries(['attacker','defender'].map(side=>[side,Object.values(test.input[side].troops).reduce((sum:number,n:any)=>sum+n,0)]));
 for(const[name,config]of Object.entries(variants)){
  const prepared=prepareBattle(test.input,config),rows:number[][]=[],scores:number[]=[],applications:Record<string,number>={},activations:number[]=[];let deterministic=false,chanceSkills:any,firstRemaining:any,firstRound;
  for(let n=0;n<(deterministic?1:repeat);n++){
   const result=runPrepared(prepared,`mia-molly-review-2026-09-07:${key}:${n}`,{mode:n<16?'trace':'fast'});deterministic=result.randomness.deterministic;
   const a=result.remaining.attacker,d=result.remaining.defender,attacker=a.infantry+a.lancer+a.marksman,defender=d.infantry+d.lancer+d.marksman;rows.push([attacker,defender,result.rounds,a.infantry,a.lancer,a.marksman,d.infantry,d.lancer,d.marksman]);scores.push(attacker-defender);
   if(n===0){chanceSkills=result.randomness.chanceSkillIds;firstRemaining=result.remaining;firstRound=result.rounds;}
   if(n<16){for(const job of result.attacks){for(const effect of job.appliedEffects??[])if(effect.source===selected.hero||effect.effectId?.startsWith(`${id}/`)){if(!effect.effectId?.startsWith(`${id}/`))continue;const k=`${effect.effectId}:${job.kind}:${job.dealerSide}.${job.dealerUnit}->${job.takerSide}.${job.takerUnit}`;applications[k]=(applications[k]??0)+1;}if(job.sourceEffectId?.startsWith(`${id}/`)){const k=`${job.sourceEffectId}:${job.kind}:${job.dealerSide}.${job.dealerUnit}->${job.takerSide}.${job.takerUnit}`;applications[k]=(applications[k]??0)+1;}}
    activations.push(['attacker','defender'].reduce((sum,side)=>sum+result.skillReport[side].filter((r:any)=>r.heroName===selected.hero&&r.skillId===id).reduce((s:number,r:any)=>s+r.skillActivations,0),0));}
  }
  raw.cases[key][name]=rows;const mean=scores.reduce((s,x)=>s+x,0)/scores.length,sd=scores.length>1?Math.sqrt(scores.reduce((s,x)=>s+(x-mean)**2,0)/(scores.length-1)):0,ordered=[...scores].sort((a,b)=>a-b);
  predictions[name]={deterministic,chanceSkills,n:scores.length,mean,sd,min:ordered[0],max:ordered.at(-1),central95:[ordered[Math.floor((ordered.length-1)*.025)],ordered[Math.floor((ordered.length-1)*.975)]],comparison:compareOutcomeDistribution({candidate:{samples:scores},reference:{samples:gameScores},initialTroops:initial.attacker+initial.defender,outcomeRange:{min:-initial.defender,max:initial.attacker},deterministic:false}),...(deterministic?{perObservationErrors:gameScores.map((g:number)=>scores[0]-g)}:{}),draws:rows.filter(r=>r[0]>0&&r[1]>0).length,firstRemaining,firstRound,tracedRuns:Math.min(scores.length,16),appliedJobCounts:applications,activationCounts:activations};
 }
 results.push({...test,initial,gameScores,predictions});console.log(JSON.stringify({skill:id,key,n:gameScores.length,predictions:Object.fromEntries(Object.entries(predictions).map(([name,r]:any)=>[name,{mean:r.mean,sd:r.sd,p:r.comparison.p,det:r.deterministic,draws:r.draws}]))}));
}
for(const[path,digest]of Object.entries(protocol.sourceHashes))assert.equal(hash(readFileSync(resolve(root,path))),digest,path);
writeFileSync(rawOutput,JSON.stringify(raw)+'\n',{flag:'wx'});
writeFileSync(output,JSON.stringify({generatedAt:new Date().toISOString(),selection:selected,protocolSha256:hash(readFileSync(resolve(dir,'protocol.json'))),repeat,seed:protocol.sampling.seed,rawSamples:{path:rawOutput,sha256:hash(readFileSync(rawOutput))},results},null,2)+'\n',{flag:'wx'});
