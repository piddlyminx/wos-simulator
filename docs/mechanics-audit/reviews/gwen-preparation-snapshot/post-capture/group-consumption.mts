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
const thirdObservation=JSON.parse(readFileSync(join(dir,'confirmed-observation.json'),'utf8'));
const output=resolve(process.argv[2] ?? join(dir,'group-consumption.json'));
assert(!existsSync(output));
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
assert.equal(hash(readFileSync(join(parent,'results.json'))),'b84a2f1302b3c07c7174699ecc1abd93d1fd319cebb9440fba95b34f506a4559');
const source:Record<string,string>={};
for(const [path,digest] of Object.entries(protocol.sourceHashes)) {
  source[path]=readFileSync(join(root,path),'utf8');assert.equal(hash(source[path]),digest);
}
assert(!config.heroDefinitions.Gwen.skills.EagleVision.effects['EagleVision/1'].trigger_effects,'This bounded candidate does not define changed child-effect timing');
const groupPatches=[
  {file:'simulator/src/extraAttacks.ts',from:'    let firstProcessedJob: DamageJob | undefined;',to:'    let firstProcessedJob: DamageJob | undefined;\n    const auditDeferredEagleVision = new Set<ActiveEffect>();'},
  {file:'simulator/src/extraAttacks.ts',from:'            chargeUsedEffectsForJob(runtime, job, recorder);',to:'            if (sourceEffectId === "Blastmaster/1") auditDeferEagleVision(runtime, auditDeferredEagleVision);\n            chargeUsedEffectsForJob(runtime, job, recorder);'},
  {file:'simulator/src/extraAttacks.ts',from:'    if (processedJobCount > 0) {',to:'    for (const retained of auditDeferredEagleVision) chargeEffectUse(runtime, retained);\n    if (processedJobCount > 0) {'},
  {file:'simulator/src/extraAttacks.ts',from:'export function captureTriggeredExtraDamage(',to:'function auditDeferEagleVision(runtime: Runtime, retained: Set<ActiveEffect>): void {\n  for (const list of [runtime.usedEffects, runtime.primaryUsedEffects]) {\n    for (let index = list.length - 1; index >= 0; index--) {\n      const effect = list[index];\n      if ((effect.source.effectId ?? effect.intent.id) !== "EagleVision/1") continue;\n      if (effect.triggerEffects?.length) throw new Error("Unspecified EagleVision child timing");\n      retained.add(effect);\n      list.splice(index, 1);\n    }\n  }\n}\n\nexport function captureTriggeredExtraDamage('}
];
const temporary=mkdtempSync(join(tmpdir(),'gwen-group-consumption-'));
async function engine(name:string,preparation:boolean) {
  const texts={...source};
  for(const patch of [...(preparation?prior.patches:[]),...groupPatches]) {
    assert.equal(texts[patch.file].split(patch.from).length,2,`Patch not unique:${patch.file}`);
    texts[patch.file]=texts[patch.file].replace(patch.from,patch.to);
  }
  for(const [path,text] of Object.entries(texts)) {
    const target=join(temporary,name,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,text);
  }
  return {combat:await import(pathToFileURL(join(temporary,name,'simulator/src/simulator.ts')).href),
    hashes:Object.fromEntries(Object.entries(texts).map(([path,text])=>[path,hash(text)]))};
}
try {
  const engines={delivery:await engine('delivery',false),previous_round:await engine('preparation',true)};
  const results=protocol.cases.map((test:any,index:number)=>{
    const input=JSON.parse(readFileSync(join(parent,test.input),'utf8'));
    const observed=prior.results[index].observed ?? {attacker:{survivors:thirdObservation.game.attackerSurvivors},defender:{survivors:thirdObservation.game.defenderSurvivors},per_troop_survivors:{defender:thirdObservation.game.defenderPerLine}};
    const predictions=Object.fromEntries(protocol.candidates.map((candidate:any)=>{
      const model=engines[candidate.sourceCount as keyof typeof engines];
      const variant=structuredClone(config);Object.assign(variant.heroDefinitions.Gwen.skills.Blastmaster.trigger,{first:candidate.first,every:candidate.every});
      const result=model.combat.runPrepared(model.combat.prepareBattle(input,variant),protocol.seed,{mode:'trace'});
      const jobs=result.attacks.filter((attack:any)=>attack.sourceEffectId==='Blastmaster/1').map((attack:any)=>({round:attack.round,target:attack.takerUnit,kills:attack.kills,
        eagleVision:(attack.appliedEffects ?? []).filter((effect:any)=>effect.effectId==='EagleVision/1').map((effect:any)=>effect.valuePct)}));
      assert(jobs.some((job:any)=>job.target==='lancer'&&job.eagleVision.length>0),'Candidate never exercised shared S1 charge on a backline');
      const grouped={score:model.combat.signedRemainingScore(result),rounds:result.rounds,winner:result.winner,remaining:result.remaining,
        signedResidual:model.combat.signedRemainingScore(result)-(observed.attacker.survivors-observed.defender.survivors),
        perLineResiduals:Object.fromEntries(['infantry','lancer','marksman'].map(unit=>[unit,result.remaining.defender[unit]-observed.per_troop_survivors.defender[unit]])),
        heroReport:result.skillReport.attacker.filter((row:any)=>row.sourceKind==='hero_skill'),jobs};
      return [candidate.name,{individualUse:prior.results[index].predictions[candidate.name],oneUsePerFanout:grouped}];
    }));
    console.log(JSON.stringify({case:test.name,predictions:Object.fromEntries(Object.entries(predictions).map(([name,row]:[string,any])=>[name,{score:row.oneUsePerFanout.score,lines:row.oneUsePerFanout.remaining.defender,rounds:row.oneUsePerFanout.rounds,counts:row.oneUsePerFanout.heroReport.map((skill:any)=>[skill.skillId,skill.skillActivations])}]))}));
    return {case:test.name,observed,predictions};
  });
  for(const [path,digest] of Object.entries(protocol.sourceHashes))assert.equal(hash(readFileSync(join(root,path))),digest);
  writeFileSync(output,JSON.stringify({generatedAt:new Date().toISOString(),phase:'Retrospective: all three endpoints, per-line survivors and skill counts known before selection and execution.',
    hypothesis:'Only during Blastmaster fanout, an eligible EagleVision effect remains active for sibling target jobs and is consumed once after that fanout. AirDominance can still consume it before Blastmaster on overlapping rounds. All other effect consumption, scope, timing, values and source-count choices remain as their frozen paired baseline.',
    sourceHashes:protocol.sourceHashes,groupPatches,runtimeHashes:Object.fromEntries(Object.entries(engines).map(([name,value])=>[name,value.hashes])),results},null,2)+'\n',{flag:'wx'});
}finally{rmSync(temporary,{recursive:true,force:true});}
