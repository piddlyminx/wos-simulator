import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {adaptTestcaseEntry} from '../../../../../simulator/src/tooling/testcases';

const dir=dirname(fileURLToPath(import.meta.url)),parent=resolve(dir,'..'),root=resolve(dir,'../../../../..');
const protocol=JSON.parse(readFileSync(join(parent,'protocol.json'),'utf8'));
const grouped=JSON.parse(readFileSync(join(dir,'group-consumption.json'),'utf8'));
const config=JSON.parse(readFileSync(join(parent,'config.json'),'utf8'));
const output=resolve(process.argv[2] ?? join(dir,'s2-mark-eligibility.json'));assert(!existsSync(output));
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const source:Record<string,string>={};
for(const [path,digest] of Object.entries(protocol.sourceHashes)) {
  source[path]=readFileSync(join(root,path),'utf8');assert.equal(hash(source[path]),digest);
}
const cases=protocol.cases.map((test:any,index:number)=>({key:test.name,input:JSON.parse(readFileSync(join(parent,test.input),'utf8')),
  game:grouped.results[index].observed.attacker.survivors-grouped.results[index].observed.defender.survivors}));
for(const name of ['gwen_solo_nc','gwen_norah_combo_nc','logan_gwen_combo_nc','renee_gwen_bucket_retry_nc']) {
  const path=`testcases/emulator_verified/${name}.json`,text=readFileSync(join(root,path),'utf8'),entry=JSON.parse(text)[0];
  cases.push({key:`${path}#0`,fixtureSha256:hash(text),input:adaptTestcaseEntry(entry),game:entry.game_report_result.map((row:any)=>row.attacker-row.defender)});
}
const temporary=mkdtempSync(join(tmpdir(),'gwen-s2-mark-'));
try {
  for(const patch of grouped.groupPatches) {
    assert.equal(source[patch.file].split(patch.from).length,2);source[patch.file]=source[patch.file].replace(patch.from,patch.to);
  }
  for(const [path,text] of Object.entries(source)) {
    const target=join(temporary,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,text);
  }
  const engine=await import(pathToFileURL(join(temporary,'simulator/src/simulator.ts')).href);
  const variant=structuredClone(config);Object.assign(variant.heroDefinitions.Gwen.skills.Blastmaster.trigger,{first:5,every:5});
  const records=cases.map((test:any)=>{
    const result=engine.runPrepared(engine.prepareBattle(test.input,variant),protocol.seed,{mode:'trace'});
    const slim=(attack:any)=>({round:attack.round,kind:attack.kind,effect:attack.sourceEffectId ?? 'normal',source:`${attack.dealerSide}.${attack.dealerUnit}`,target:`${attack.takerSide}.${attack.takerUnit}`,kills:attack.kills,
      modifiers:(attack.appliedEffects ?? []).filter((effect:any)=>['EagleVision/1','AirDominance/2'].includes(effect.effectId)).map((effect:any)=>({id:effect.effectId,value:effect.valuePct}))});
    const eligible=result.attacks.flatMap((attack:any,index:number)=>{
      if(attack.sourceEffectId!=='AirDominance/1')return [];
      const later=result.attacks.slice(index+1).filter((next:any)=>next.dealerSide===attack.dealerSide&&next.takerSide===attack.takerSide&&next.takerUnit===attack.takerUnit);
      const currentMark=later.find((next:any)=>(next.appliedEffects ?? []).some((effect:any)=>effect.effectId==='AirDominance/2'));
      return [{s2:slim(attack),nextActualDamage:later[0]?slim(later[0]):null,currentMarkApplied:currentMark?slim(currentMark):null}];
    });
    const overlaps=result.attacks.filter((attack:any)=>['EagleVision/1','AirDominance/2'].every(id=>(attack.appliedEffects ?? []).some((effect:any)=>effect.effectId===id))).map(slim);
    const record={...test,deterministic:result.randomness.deterministic,chanceSkills:result.randomness.chanceSkillIds,score:engine.signedRemainingScore(result),remaining:result.remaining,rounds:result.rounds,eligible,overlaps,
      heroReport:result.skillReport,attacks:result.attacks.map(slim)};
    console.log(JSON.stringify({key:test.key,game:test.game,score:record.score,deterministic:record.deterministic,overlaps:overlaps.length,nextSameRound:eligible.filter((row:any)=>row.nextActualDamage?.round===row.s2.round).length,s2Jobs:eligible.length,nextEffects:[...new Set(eligible.map((row:any)=>row.nextActualDamage?.effect))]}));
    return record;
  });
  writeFileSync(output,JSON.stringify({generatedAt:new Date().toISOString(),phase:'Retrospective eligibility trace before selecting any S2 followup-mark candidate. All existing game outcomes accepted.',
    base:'Previously diagnosed first5/every5 S3 with one EagleVision use per fanout, delivery source count. Other hero/troop kit preserved.',sourceHashes:protocol.sourceHashes,groupPatches:grouped.groupPatches,records},null,2)+'\n',{flag:'wx'});
}finally{rmSync(temporary,{recursive:true,force:true});}
