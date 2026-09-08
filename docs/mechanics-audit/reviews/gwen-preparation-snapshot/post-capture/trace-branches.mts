import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const dir=dirname(fileURLToPath(import.meta.url)),parent=resolve(dir,'..'),root=resolve(dir,'../../../../..');
const protocol=JSON.parse(readFileSync(join(parent,'protocol.json'),'utf8'));
const prior=JSON.parse(readFileSync(join(parent,'results.json'),'utf8'));
const config=JSON.parse(readFileSync(join(parent,'config.json'),'utf8'));
const output=resolve(process.argv[2] ?? join(dir,'branch-traces.json'));
assert(!existsSync(output));
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
assert.equal(hash(readFileSync(join(parent,'results.json'))),'b84a2f1302b3c07c7174699ecc1abd93d1fd319cebb9440fba95b34f506a4559');
const source:Record<string,string>={};
for(const [path,digest] of Object.entries(protocol.sourceHashes)) {
  source[path]=readFileSync(join(root,path),'utf8');assert.equal(hash(source[path]),digest);
}
const diagnosticPatches=[
  {file:'simulator/src/runtime.ts',from:'export function targetExhausted(',to:'export const auditBranchEvents: any[] = [];\n\nexport function targetExhausted('},
  {file:'simulator/src/runtime.ts',from:'  return available <= 0 || roundTargetDamage[job.takerSide][job.takerUnit] >= available;',to:'  const exhausted = available <= 0 || roundTargetDamage[job.takerSide][job.takerUnit] >= available;\n  if (exhausted) auditBranchEvents.push({type:"target_exhausted",job,available,alreadyDamaged:roundTargetDamage[job.takerSide][job.takerUnit]});\n  return exhausted;'},
  {file:'simulator/src/runtime.ts',from:'  result.kills = Math.min(result.kills, remaining);',to:'  if (result.kills > remaining) auditBranchEvents.push({type:"capped_job",job,available,alreadyDamaged,remaining,uncappedKills:result.kills});\n  result.kills = Math.min(result.kills, remaining);'},
  {file:'simulator/src/runtime.ts',from:'  for (const effect of runtime.usedEffects) chargeEffectUse(runtime, effect);\n  runtime.usedEffects.length = 0;\n  runtime.primaryUsedEffects.length = 0;\n}\n\nexport function effectUseIntent',
    to:'  for (const effect of runtime.usedEffects) {\n    if (/^(EagleVision|AirDominance)\\//.test(effect.source.effectId ?? effect.intent.id)) auditBranchEvents.push({type:"gwen_effect_use",job,effectId:effect.source.effectId ?? effect.intent.id,createdRound:effect.createdRound,usesBefore:effect.uses,remainingDelay:effect.remainingAttackDelay});\n    chargeEffectUse(runtime, effect);\n  }\n  runtime.usedEffects.length = 0;\n  runtime.primaryUsedEffects.length = 0;\n}\n\nexport function effectUseIntent'}
];
const temporary=mkdtempSync(join(tmpdir(),'gwen-branch-trace-'));
async function engine(name:string,preparation:boolean) {
  const texts={...source};
  for(const patch of [...(preparation?prior.patches:[]),...diagnosticPatches]) {
    assert.equal(texts[patch.file].split(patch.from).length,2,`Patch not unique:${patch.file}`);
    texts[patch.file]=texts[patch.file].replace(patch.from,patch.to);
  }
  for(const [path,text] of Object.entries(texts)) {
    const target=join(temporary,name,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,text);
  }
  return {combat:await import(pathToFileURL(join(temporary,name,'simulator/src/simulator.ts')).href),
    runtime:await import(pathToFileURL(join(temporary,name,'simulator/src/runtime.ts')).href),
    hashes:Object.fromEntries(Object.entries(texts).map(([path,text])=>[path,hash(text)]))};
}
try {
  const engines={delivery:await engine('delivery',false),previous_round:await engine('preparation',true)};
  const summaries:any[]=[];
  const results=protocol.cases.map((test:any,index:number)=>{
    const input=JSON.parse(readFileSync(join(parent,test.input),'utf8'));
    const predictions=Object.fromEntries(protocol.candidates.map((candidate:any)=>{
      const model=engines[candidate.sourceCount as keyof typeof engines];model.runtime.auditBranchEvents.length=0;
      const variant=structuredClone(config);Object.assign(variant.heroDefinitions.Gwen.skills.Blastmaster.trigger,{first:candidate.first,every:candidate.every});
      const result=model.combat.runPrepared(model.combat.prepareBattle(input,variant),protocol.seed,{mode:'trace'});
      assert.deepEqual(result.remaining,prior.results[index].predictions[candidate.name].remaining,'Instrumentation changed endpoint');
      const events=structuredClone(model.runtime.auditBranchEvents);
      const depletion=Object.fromEntries(['infantry','lancer','marksman'].map(unit=>[unit,result.trace.rounds.find((row:any)=>row.roundStartTroops.defender[unit]===0)?.round ?? null]));
      const attacks=result.attacks.filter((attack:any)=>attack.dealerSide==='attacker').map((attack:any)=>({round:attack.round,kind:attack.kind,effect:attack.sourceEffectId ?? 'normal',target:attack.takerUnit,kills:attack.kills,
        gwenModifiers:(attack.appliedEffects ?? []).filter((effect:any)=>/^(EagleVision|AirDominance)\//.test(effect.effectId)).map((effect:any)=>({id:effect.effectId,valuePct:effect.valuePct})),
        rawDamage:attack.trace.rawDamage,armyTerm:attack.trace.armyTerm}));
      const uses=events.filter((event:any)=>event.type==='gwen_effect_use');
      const keys=[...new Set(uses.map((event:any)=>`${event.effectId}:${event.job.sourceEffectId ?? 'normal'}:${event.job.takerUnit}`))];
      const useCounts=Object.fromEntries(keys.map(key=>[key,uses.filter((event:any)=>`${event.effectId}:${event.job.sourceEffectId ?? 'normal'}:${event.job.takerUnit}`===key).length]));
      const summary={case:test.name,candidate:candidate.name,rounds:result.rounds,score:model.combat.signedRemainingScore(result),depletionRoundStarts:depletion,
        exhaustionEvents:events.filter((event:any)=>event.type==='target_exhausted').map((event:any)=>({round:event.job.round,source:event.job.sourceEffectId ?? `${event.job.dealerSide}.normal`,target:event.job.takerUnit})),
        cappedEvents:events.filter((event:any)=>event.type==='capped_job').map((event:any)=>({round:event.job.round,source:event.job.sourceEffectId ?? `${event.job.dealerSide}.normal`,target:event.job.takerUnit,remaining:event.remaining,uncappedKills:event.uncappedKills})),
        useCounts};
      summaries.push(summary);
      return [candidate.name,{summary,rounds:result.trace.rounds.map((row:any)=>({round:row.round,troops:row.roundStartTroops})),attacks,events}];
    }));
    return {case:test.name,predictions};
  });
  for(const [path,digest] of Object.entries(protocol.sourceHashes))assert.equal(hash(readFileSync(join(root,path))),digest);
  writeFileSync(output,JSON.stringify({generatedAt:new Date().toISOString(),phase:'Post-third-outcome diagnostic; game24 and skill counts already known.',sourceHashes:protocol.sourceHashes,
    diagnosticPatches,runtimeHashes:Object.fromEntries(Object.entries(engines).map(([name,value])=>[name,value.hashes])),
    interpretation:'Instrumentation only records branches; every endpoint is checked against the original frozen forecast. Source-count candidate patches are exactly those previously frozen.',results},null,2)+'\n',{flag:'wx'});
  const summaryPath=output.replace(/\.json$/,'.summary.json');assert(!existsSync(summaryPath));writeFileSync(summaryPath,JSON.stringify(summaries,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(summaries.map(({case:caseName,candidate,rounds,score,depletionRoundStarts,exhaustionEvents,cappedEvents})=>({case:caseName,candidate,rounds,score,depletionRoundStarts,exhaustionEvents,cappedEvents}))));
}finally{rmSync(temporary,{recursive:true,force:true});}
