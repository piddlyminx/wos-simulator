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
const suffix=process.argv[3]??'initial',repeat=Number(process.argv[4]??(selected.hero==='Gatot'?500:1000)),output=resolve(dir,`${id}-${suffix}.json`),rawOutput=resolve(dir,`${id}-${suffix}-samples.json`);assert(!existsSync(output)&&!existsSync(rawOutput));
for(const[path,digest]of Object.entries(protocol.artifacts))assert.equal(hash(readFileSync(resolve(dir,path))),digest,path);
function guard(){for(const[path,digest]of Object.entries(protocol.sourceHashes))assert.equal(hash(readFileSync(resolve(root,path))),digest,path);}
guard();
const variants=Object.fromEntries(protocol.variants[id].map((name:string)=>{
 const config=structuredClone(base),skill=config.heroDefinitions[selected.hero].skills[id];
 if(name==='omit')skill.effects={};
 if(name==='all_own')skill.effects[`${id}/1`].units.applies_to='self.any';
 if(name==='normal_only')skill.effects[`${id}/1`].applies_to_damage_kinds=['normal'];
 if(name==='enemy_infantry_only')skill.effects[`${id}/1`].units.applies_to='enemy.infantry';
 if(selected.hero==='Renee'&&name!=='omit'){
  const carrier=skill.effects[`${id}/mark`],child=carrier.trigger_effects[`${id}/1`];
  if(name==='skill_kind')child.trigger_damage_jobs[0].damage_kind='skill';
  if(name==='immediate_delivery')child.duration.turns.delay=0;
  if(name==='carrier_all_sources')carrier.units.applies_to='self.any';
  if(name==='both_kinds')delete child.applies_to_damage_kinds;
  if(name==='all_sources')child.units.applies_vs='any';
  if(name==='lancer_only')child.units.applies_vs='parent.use.source';
 }
 return[name,config];
}));
const raw:any={sampleColumns:['attacker','defender','rounds','attackerInfantry','attackerLancer','attackerMarksman','defenderInfantry','defenderLancer','defenderMarksman','winnerCode_draw0_attacker1_defenderMinus1'],cases:{}};const results=[];
for(const key of selected.fixtureKeys){const test=cases[key],predictions:any={};raw.cases[key]={};const observations=Array.isArray(test.game)?test.game:[test.game],gameScores=observations.map((o:any)=>o.attacker-o.defender),initial=Object.fromEntries(['attacker','defender'].map(side=>[side,Object.values(test.input[side].troops).reduce((sum:number,n:any)=>sum+n,0)]));
 for(const[name,config]of Object.entries(variants)){
  const prepared=prepareBattle(test.input,config),rows:number[][]=[],scores:number[]=[],annotations:Record<string,number>={},generated:Record<string,number>={},activations:number[]=[];let deterministic=false,chanceSkills:any,firstRemaining:any,firstRound,firstWinner;
  for(let n=0;n<(deterministic?1:repeat);n++){
   const result=runPrepared(prepared,`gatot-renee-review-2026-09-07:${key}:${n}`,{mode:n<16?'trace':'fast'});deterministic=result.randomness.deterministic;
   const a=result.remaining.attacker,d=result.remaining.defender,attacker=a.infantry+a.lancer+a.marksman,defender=d.infantry+d.lancer+d.marksman;rows.push([attacker,defender,result.rounds,a.infantry,a.lancer,a.marksman,d.infantry,d.lancer,d.marksman,result.winner==='draw'?0:result.winner==='attacker'?1:-1]);scores.push(attacker-defender);
   if(n===0){chanceSkills=result.randomness.chanceSkillIds;firstRemaining=result.remaining;firstRound=result.rounds;firstWinner=result.winner;}
   if(n<16){for(const job of result.attacks){for(const effect of job.appliedEffects??[])if(effect.effectId?.startsWith(`${id}/`)){const k=`${effect.effectId}:${job.kind}:${job.dealerSide}.${job.dealerUnit}->${job.takerSide}.${job.takerUnit}`;annotations[k]=(annotations[k]??0)+1;}if(job.sourceEffectId?.startsWith(`${id}/`)){const k=`${job.sourceEffectId}:${job.kind}:${job.dealerSide}.${job.dealerUnit}->${job.takerSide}.${job.takerUnit}`;generated[k]=(generated[k]??0)+1;}}
    activations.push(['attacker','defender'].reduce((sum,side)=>sum+result.skillReport[side].filter((r:any)=>r.heroName===selected.hero&&r.skillId===id).reduce((s:number,r:any)=>s+r.skillActivations,0),0));}
  }
  raw.cases[key][name]=rows;const mean=scores.reduce((s,x)=>s+x,0)/scores.length,sd=scores.length>1?Math.sqrt(scores.reduce((s,x)=>s+(x-mean)**2,0)/(scores.length-1)):0,ordered=[...scores].sort((a,b)=>a-b);
  predictions[name]={deterministic,chanceSkills,n:scores.length,mean,sd,min:ordered[0],max:ordered.at(-1),central95:[ordered[Math.floor((ordered.length-1)*.025)],ordered[Math.floor((ordered.length-1)*.975)]],winnerCounts:{attacker:rows.filter(r=>r[9]===1).length,defender:rows.filter(r=>r[9]===-1).length,draw:rows.filter(r=>r[9]===0).length},rounds:{min:Math.min(...rows.map(r=>r[2])),max:Math.max(...rows.map(r=>r[2])),mean:rows.reduce((s,r)=>s+r[2],0)/rows.length},individualGameSupport:observations.map((o:any)=>({observation:o,scoreLeCount:scores.filter(s=>s<=o.attacker-o.defender).length,scoreGeCount:scores.filter(s=>s>=o.attacker-o.defender).length,exactSideTotals:rows.filter(r=>r[0]===o.attacker&&r[1]===o.defender).length,exactSidesAndKnownRound:rows.filter(r=>r[0]===o.attacker&&r[1]===o.defender&&(o.rounds===undefined||r[2]===o.rounds)).length})),comparison:deterministic?null:compareOutcomeDistribution({candidate:{samples:scores},reference:{samples:gameScores},initialTroops:initial.attacker+initial.defender,outcomeRange:{min:-initial.defender,max:initial.attacker},deterministic:false}),...(deterministic?{perObservationErrors:gameScores.map((g:number)=>scores[0]-g),perObservationSideErrors:observations.map((o:any)=>({attacker:rows[0][0]-o.attacker,defender:rows[0][1]-o.defender,rounds:o.rounds===undefined?null:rows[0][2]-o.rounds}))}:{}),draws:rows.filter(r=>r[0]>0&&r[1]>0).length,firstRemaining,firstRound,firstWinner,tracedRuns:Math.min(scores.length,16),modifierAnnotationCounts:annotations,generatedDamageJobCounts:generated,activationCounts:activations};
 }
 results.push({...test,initial,gameScores,predictions});console.log(JSON.stringify({skill:id,key,n:gameScores.length,predictions:Object.fromEntries(Object.entries(predictions).map(([name,r]:any)=>[name,{mean:r.mean,sd:r.sd,p:r.comparison?.p??null,det:r.deterministic,draws:r.draws}]))}));
}
guard();writeFileSync(rawOutput,JSON.stringify(raw)+'\n',{flag:'wx'});
writeFileSync(output,JSON.stringify({generatedAt:new Date().toISOString(),selection:selected,protocolSha256:hash(readFileSync(resolve(dir,'protocol.json'))),repeat,seed:protocol.sampling.seed,rawSamples:{path:rawOutput,sha256:hash(readFileSync(rawOutput))},results},null,2)+'\n',{flag:'wx'});
