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
function guard(){for(const[path,digest]of Object.entries(protocol.sourceHashes))assert.equal(hash(readFileSync(resolve(root,path))),digest,path);}
guard();
const variants=Object.fromEntries(protocol.variants[id].map((name:string)=>{
 const config=structuredClone(base),skill=config.heroDefinitions[selected.hero].skills[id];
 if(name==='omit')skill.effects={};
 if(name==='marksman_only')for(const effect of Object.values(skill.effects)as any[])effect.units={...effect.units,applies_to:'marksman'};
 if(name==='infantry_only')for(const effect of Object.values(skill.effects)as any[])effect.units={...effect.units,applies_to:'infantry'};
 if(name==='enemy_infantry_only')for(const effect of Object.values(skill.effects)as any[])effect.units={...effect.units,applies_to:'enemy.infantry'};
 if(name==='normal_only')for(const effect of Object.values(skill.effects)as any[])effect.applies_to_damage_kinds=['normal'];
 if(name==='hero_damage_bucket')for(const effect of Object.values(skill.effects)as any[])effect.type='active.hero.damage.up';
 if(name==='max_stack')for(const effect of Object.values(skill.effects)as any[])effect.same_effect_stacking='max';
 if(name==='all_own')for(const effect of Object.values(skill.effects)as any[])effect.units={...effect.units,applies_to:'self.any'};
 if(name==='omit_offense')delete skill.effects[id==='CombinedArms'?'CombinedArms/2':'Momentum/1'];
 if(name==='omit_protection')delete skill.effects[id==='CombinedArms'?'CombinedArms/1':'Momentum/2'];
 if(name==='primary_target_only')for(const effect of Object.values(skill.effects)as any[])for(const job of effect.trigger_damage_jobs??[])job.target='use.target';
 if(name==='normal_kind')for(const effect of Object.values(skill.effects)as any[])for(const job of effect.trigger_damage_jobs??[])job.damage_kind='normal';
 if(name==='all_sources'){skill.trigger.source='self.any';for(const effect of Object.values(skill.effects)as any[])effect.units.applies_to='trigger.source';}
 if(name==='immediate')for(const effect of Object.values(skill.effects)as any[])delete effect.duration.turns.delay;
 if(name==='one_turn')for(const effect of Object.values(skill.effects)as any[])effect.duration.turns.count=1;
 if(name==='all_enemy')skill.effects['Momentum/1'].units.applies_vs='enemy.any';
 return[name,config];
}));
const raw:any={sampleColumns:['attacker','defender','rounds','attackerInfantry','attackerLancer','attackerMarksman','defenderInfantry','defenderLancer','defenderMarksman'],cases:{}};const results=[];
for(const key of selected.coverage.fixture_keys){const test=cases[key],predictions:any={};raw.cases[key]={};const observations=Array.isArray(test.game)?test.game:[test.game],gameScores=observations.map((o:any)=>o.attacker-o.defender),initial=Object.fromEntries(['attacker','defender'].map(side=>[side,Object.values(test.input[side].troops).reduce((sum:number,n:any)=>sum+n,0)]));
 for(const[name,config]of Object.entries(variants)){
  const prepared=prepareBattle(test.input,config),rows:number[][]=[],scores:number[]=[],annotations:Record<string,number>={},generated:Record<string,number>={},activations:number[]=[];let deterministic=false,chanceSkills:any,firstRemaining:any,firstRound,firstWinner;
  for(let n=0;n<(deterministic?1:repeat);n++){
   const result=runPrepared(prepared,`remaining-ordinary-review-2026-09-07:${key}:${n}`,{mode:n<16?'trace':'fast'});deterministic=result.randomness.deterministic;
   const a=result.remaining.attacker,d=result.remaining.defender,attacker=a.infantry+a.lancer+a.marksman,defender=d.infantry+d.lancer+d.marksman;rows.push([attacker,defender,result.rounds,a.infantry,a.lancer,a.marksman,d.infantry,d.lancer,d.marksman]);scores.push(attacker-defender);
   if(n===0){chanceSkills=result.randomness.chanceSkillIds;firstRemaining=result.remaining;firstRound=result.rounds;firstWinner=result.winner;}
   if(n<16){for(const job of result.attacks){for(const effect of job.appliedEffects??[])if(effect.effectId?.startsWith(`${id}/`)){const k=`${effect.effectId}:${job.kind}:${job.dealerSide}.${job.dealerUnit}->${job.takerSide}.${job.takerUnit}`;annotations[k]=(annotations[k]??0)+1;}if(job.sourceEffectId?.startsWith(`${id}/`)){const k=`${job.sourceEffectId}:${job.kind}:${job.dealerSide}.${job.dealerUnit}->${job.takerSide}.${job.takerUnit}`;generated[k]=(generated[k]??0)+1;}}
    activations.push(['attacker','defender'].reduce((sum,side)=>sum+result.skillReport[side].filter((r:any)=>r.heroName===selected.hero&&r.skillId===id).reduce((s:number,r:any)=>s+r.skillActivations,0),0));}
  }
  raw.cases[key][name]=rows;const mean=scores.reduce((s,x)=>s+x,0)/scores.length,sd=scores.length>1?Math.sqrt(scores.reduce((s,x)=>s+(x-mean)**2,0)/(scores.length-1)):0,ordered=[...scores].sort((a,b)=>a-b);
  predictions[name]={deterministic,chanceSkills,n:scores.length,mean,sd,min:ordered[0],max:ordered.at(-1),central95:[ordered[Math.floor((ordered.length-1)*.025)],ordered[Math.floor((ordered.length-1)*.975)]],comparison:deterministic?null:compareOutcomeDistribution({candidate:{samples:scores},reference:{samples:gameScores},initialTroops:initial.attacker+initial.defender,outcomeRange:{min:-initial.defender,max:initial.attacker},deterministic:false}),...(deterministic?{perObservationErrors:gameScores.map((g:number)=>scores[0]-g),perObservationSideErrors:observations.map((o:any)=>({attacker:rows[0][0]-o.attacker,defender:rows[0][1]-o.defender,rounds:o.rounds===undefined?null:rows[0][2]-o.rounds}))}:{}),draws:rows.filter(r=>r[0]>0&&r[1]>0).length,firstRemaining,firstRound,firstWinner,tracedRuns:Math.min(scores.length,16),modifierAnnotationCounts:annotations,generatedDamageJobCounts:generated,activationCounts:activations};
 }
 results.push({...test,initial,gameScores,predictions});console.log(JSON.stringify({skill:id,key,n:gameScores.length,predictions:Object.fromEntries(Object.entries(predictions).map(([name,r]:any)=>[name,{mean:r.mean,sd:r.sd,p:r.comparison?.p??null,det:r.deterministic,draws:r.draws}]))}));
}
guard();writeFileSync(rawOutput,JSON.stringify(raw)+'\n',{flag:'wx'});
writeFileSync(output,JSON.stringify({generatedAt:new Date().toISOString(),selection:selected,protocolSha256:hash(readFileSync(resolve(dir,'protocol.json'))),repeat,seed:protocol.sampling.seed,rawSamples:{path:rawOutput,sha256:hash(readFileSync(rawOutput))},results},null,2)+'\n',{flag:'wx'});
