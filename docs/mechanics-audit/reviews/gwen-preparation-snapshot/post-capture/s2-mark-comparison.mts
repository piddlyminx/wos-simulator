import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const dir=dirname(fileURLToPath(import.meta.url)),parent=resolve(dir,'..'),root=resolve(dir,'../../../../..');
const eligibility=JSON.parse(readFileSync(join(dir,'s2-mark-eligibility.json'),'utf8'));
const config=JSON.parse(readFileSync(join(parent,'config.json'),'utf8'));
const output=resolve(process.argv[2] ?? join(dir,'s2-mark-comparison.json'));assert(!existsSync(output));
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const source:Record<string,string>={};
for(const [path,digest] of Object.entries(eligibility.sourceHashes)) {
  source[path]=readFileSync(join(root,path),'utf8');assert.equal(hash(source[path]),digest);
}
const base=structuredClone(config);Object.assign(base.heroDefinitions.Gwen.skills.Blastmaster.trigger,{first:5,every:5});
const variants:Record<string,any>={delayed_top_level:base,immediate_top_level:structuredClone(base),after_s2_next_damage:structuredClone(base),after_s2_next_normal:structuredClone(base)};
variants.immediate_top_level.heroDefinitions.Gwen.skills.AirDominance.effects['AirDominance/2'].duration.turns.delay=0;
for(const name of ['after_s2_next_damage','after_s2_next_normal']) {
  const skill=variants[name].heroDefinitions.Gwen.skills.AirDominance;
  const mark=skill.effects['AirDominance/2'];delete skill.effects['AirDominance/2'];
  mark.units={applies_to:'parent.use.target'};mark.duration={attacks:{count:1}};
  if(name==='after_s2_next_normal')mark.applies_to_damage_kinds=['normal'];
  skill.effects['AirDominance/1'].trigger_effects={'AirDominance/2':mark};
}
const definitions={
  delayed_top_level:'Existing mark: created on S2 normal-attack declaration, activates next round, one attack use.',
  immediate_top_level:'Previously considered immediate candidate: same top-level mark activates before the triggering normal damage. Diagnostic only; this is not a mark created after S2 damage.',
  after_s2_next_damage:'Mark is a child of the actual S2 extra attack; activates after that S2 hit, lasts until the next eligible normal or skill damage job on its target. Same value, scope and max stacking.',
  after_s2_next_normal:'Same post-S2 child mark, restricted to normal damage jobs. This changes only eligible damage kind relative to after_s2_next_damage.'
};
const temporary=mkdtempSync(join(tmpdir(),'gwen-s2-mark-comparison-'));
try {
  for(const patch of eligibility.groupPatches) {
    assert.equal(source[patch.file].split(patch.from).length,2);source[patch.file]=source[patch.file].replace(patch.from,patch.to);
  }
  for(const [path,text] of Object.entries(source)) {
    const target=join(temporary,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,text);
  }
  const engine=await import(pathToFileURL(join(temporary,'simulator/src/simulator.ts')).href);
  const results=eligibility.records.filter((row:any)=>row.deterministic).map((test:any)=>{
    const predictions=Object.fromEntries(Object.entries(variants).map(([name,variant])=>{
      const result=engine.runPrepared(engine.prepareBattle(test.input,variant),'gwen-s2-mark-comparison',{mode:'trace'});
      assert(result.randomness.deterministic);
      if(name==='delayed_top_level')assert.deepEqual(result.remaining,test.remaining,'Baseline drift');
      if(name==='after_s2_next_normal'&&!test.key.startsWith('testcases/'))assert.deepEqual(result.remaining,test.remaining,'Changing next-normal mark timing should not alter these single-source inputs');
      const marks=result.attacks.filter((attack:any)=>(attack.appliedEffects ?? []).some((effect:any)=>effect.effectId==='AirDominance/2')).map((attack:any)=>({round:attack.round,kind:attack.kind,effect:attack.sourceEffectId ?? 'normal',source:attack.dealerUnit,target:attack.takerUnit,kills:attack.kills,
        s1AlsoApplies:(attack.appliedEffects ?? []).some((effect:any)=>effect.effectId==='EagleVision/1')}));
      return [name,{score:engine.signedRemainingScore(result),remaining:result.remaining,rounds:result.rounds,marks,heroReport:result.skillReport}];
    }));
    console.log(JSON.stringify({key:test.key,game:test.game,predictions:Object.fromEntries(Object.entries(predictions).map(([name,row]:[string,any])=>[name,{score:row.score,lines:row.remaining.defender,rounds:row.rounds,markKinds:[...new Set(row.marks.map((mark:any)=>mark.kind))]}]))}));
    return {key:test.key,game:test.game,input:test.input,predictions};
  });
  for(const [path,digest] of Object.entries(eligibility.sourceHashes))assert.equal(hash(readFileSync(join(root,path))),digest);
  writeFileSync(output,JSON.stringify({generatedAt:new Date().toISOString(),phase:'Retrospective; candidate selection follows saved eligibility traces. No coefficient fitted.',
    selectionReason:'S1/S2 never overlap in seven current traces, so simple nonstacking cannot repair them. Post-S2 next damage differs from next normal on same-cluster S3 hits in three captures and from next-turn scheduling on later same-round normal hits in mixed formations.',
    scope:'All six accepted deterministic Gwen S2-bearing inputs: three new captures and three earlier fixtures, including unchanged full Renee/Gwen2/1/0. Gwen/Norah is stochastic and remains accepted; its one trace is not a distribution verdict and is separately listed.',
    excludedStochastic:eligibility.records.filter((row:any)=>!row.deterministic).map((row:any)=>({key:row.key,game:row.game,chanceSkills:row.chanceSkills})),
    sourceHashes:eligibility.sourceHashes,definitions,variantConfigurations:variants,groupPatches:eligibility.groupPatches,results},null,2)+'\n',{flag:'wx'});
}finally{rmSync(temporary,{recursive:true,force:true});}
