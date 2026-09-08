import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const dir=dirname(fileURLToPath(import.meta.url)),root=resolve(dir,'../../../..');
const protocol=JSON.parse(readFileSync(join(dir,'protocol.json'),'utf8'));
const output=resolve(process.argv[2] ?? join(dir,'results.json'));
assert(!existsSync(output),'Preserve the original retrospective results');
const hash=(text:Buffer|string)=>createHash('sha256').update(text).digest('hex');
for(const [name,digest] of Object.entries(protocol.frozenFiles))assert.equal(hash(readFileSync(join(dir,name))),digest,`Frozen file changed:${name}`);
const sources:Record<string,string>={};
for(const [path,digest] of Object.entries(protocol.sourceHashes)) {
  const text=readFileSync(join(root,path),'utf8');assert.equal(hash(text),digest,`Engine changed:${path}`);
  sources[path]=text;
}
const config=JSON.parse(readFileSync(join(dir,'config.json'),'utf8'));
const patches=[
  {file:'simulator/src/damage.ts',from:'  minInitialArmy?: number;',to:'  minInitialArmy?: number;\n  auditPreviousRoundTroops?: DamageJob["roundStartTroops"];'},
  {file:'simulator/src/damage.ts',from:'  const dealerTroops = ceilIgnoringFloatResidue(\n    Math.max(0, job.roundStartTroops[job.dealerSide][job.dealerUnit] ?? 0)\n  );',
    to:'  const auditSourceTroops = job.sourceEffectId === "Blastmaster/1"\n    ? options.auditPreviousRoundTroops : job.roundStartTroops;\n  if (!auditSourceTroops) throw new Error("S3 source snapshot missing");\n  const dealerTroops = ceilIgnoringFloatResidue(\n    Math.max(0, auditSourceTroops[job.dealerSide][job.dealerUnit] ?? 0)\n  );'},
  {file:'simulator/src/simulator.ts',from:'    minInitialArmy: initialArmyCount\n  };',to:'    minInitialArmy: initialArmyCount,\n    auditPreviousRoundTroops: undefined as DamageJob["roundStartTroops"] | undefined\n  };'},
  {file:'simulator/src/simulator.ts',from:'  let rounds = 0;\n  let score = 0;',to:'  let auditPreviousRoundTroops: DamageJob["roundStartTroops"] | undefined;\n  let rounds = 0;\n  let score = 0;'},
  {file:'simulator/src/simulator.ts',from:'    const roundStartTroops = snapshotTroops(runtime.troops);',to:'    const roundStartTroops = snapshotTroops(runtime.troops);\n    damageJobOptions.auditPreviousRoundTroops = auditPreviousRoundTroops;\n    auditPreviousRoundTroops = roundStartTroops;'}
];
const temporary=mkdtempSync(join(tmpdir(),'gwen-source-snapshot-'));
const runtimeHashes:Record<string,any>={};
async function runtime(name:string,changed:boolean) {
  const texts={...sources};
  if(changed)for(const patch of patches) {
    assert.equal(texts[patch.file].split(patch.from).length,2,`Patch anchor not unique:${patch.file}`);
    texts[patch.file]=texts[patch.file].replace(patch.from,patch.to);
  }
  for(const [path,text] of Object.entries(texts)) {
    const destination=join(temporary,name,path);mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,text);
  }
  runtimeHashes[name]=Object.fromEntries(Object.entries(texts).map(([path,text])=>[path,hash(text)]));
  return await import(pathToFileURL(join(temporary,name,'simulator/src/simulator.ts')).href);
}
const total=(counts:any)=>Object.values(counts).reduce((sum:number,value:any)=>sum+value,0);
try {
  const current=await runtime('delivery',false),snapshot=await runtime('previous_round',true);
  const results=protocol.cases.map((test:any)=>{
    const input=JSON.parse(readFileSync(join(dir,test.input),'utf8'));
    const observed=test.observation ? JSON.parse(readFileSync(join(dir,test.observation),'utf8')) : null;
    const predictions=Object.fromEntries(protocol.candidates.map((candidate:any)=>{
      const engine=candidate.sourceCount==='delivery'?current:snapshot;
      const variant=structuredClone(config);
      Object.assign(variant.heroDefinitions.Gwen.skills.Blastmaster.trigger,{first:candidate.first,every:candidate.every});
      const result=engine.runPrepared(engine.prepareBattle(input,variant),protocol.seed,{mode:'trace'});
      assert(result.randomness.deterministic);
      assert.equal(result.attackControlCounts.no_attack,0);assert.equal(result.attackControlCounts.dodge,0);
      const sourceNormals=result.attacks.filter((attack:any)=>attack.kind==='normal'&&attack.dealerSide==='attacker');
      assert.deepEqual(sourceNormals.map((attack:any)=>attack.round),Array.from({length:result.rounds},(_,i)=>i+1),'Previous round is not equivalent to previous normal attack');
      const expectedInitialArmy=Math.min(total(result.resolved.attacker.troops),total(result.resolved.defender.troops));
      const jobs=result.attacks.filter((attack:any)=>attack.sourceEffectId==='Blastmaster/1').map((attack:any)=>{
        const sourceRound=attack.round-(candidate.sourceCount==='previous_round'?1:0);
        assert(sourceRound>=1&&sourceRound<=attack.round);
        const sourceCount=result.trace.rounds.find((row:any)=>row.round===sourceRound).roundStartTroops[attack.dealerSide][attack.dealerUnit];
        const deliveryCount=result.trace.rounds.find((row:any)=>row.round===attack.round).roundStartTroops[attack.dealerSide][attack.dealerUnit];
        const ceiled=Math.ceil(sourceCount-1e-12),expectedArmyTerm=Math.sqrt(ceiled)*Math.sqrt(expectedInitialArmy);
        assert(Math.abs(expectedArmyTerm-attack.trace.armyTerm)<1e-9,'Wrong S3 source count used');
        assert(sourceCount>=deliveryCount);
        return {round:attack.round,target:attack.takerUnit,kind:attack.kind,sourceCountRound:sourceRound,sourceCount,deliveryCount,ceiledSourceCount:ceiled,armyTerm:attack.trace.armyTerm,rawKills:attack.kills};
      });
      // Every other job keeps its delivery-time source count, including both S1/S2 interactions.
      for(const attack of result.attacks.filter((attack:any)=>attack.sourceEffectId!=='Blastmaster/1')) {
        const count=attack.trace.roundStartTroops[attack.dealerSide][attack.dealerUnit];
        assert(Math.abs(Math.sqrt(Math.ceil(count-1e-12))*Math.sqrt(expectedInitialArmy)-attack.trace.armyTerm)<1e-9,'Non-S3 source count changed');
      }
      const residuals=observed ? Object.fromEntries(['infantry','lancer','marksman'].map(unit=>[unit,result.remaining.defender[unit]-observed.per_troop_survivors.defender[unit]])) : null;
      return [candidate.name,{rounds:result.rounds,winner:result.winner,remaining:result.remaining,defenderTotal:total(result.remaining.defender),signedRemaining:engine.signedRemainingScore(result),
        totalResidual:observed ? total(result.remaining.defender)-observed.defender.survivors : null,perLineResiduals:residuals,
        heroReport:result.skillReport.attacker.filter((row:any)=>row.sourceKind==='hero_skill'),jobs,
        everyDefenderLineSurvives:Object.values(result.remaining.defender).every((count:any)=>count>0)}];
    }));
    console.log(JSON.stringify({case:test.name,predictions:Object.fromEntries(Object.entries(predictions).map(([name,value]:[string,any])=>[name,{defender:value.defenderTotal,lines:value.remaining.defender,residual:value.totalResidual,counts:value.heroReport.map((r:any)=>[r.skillId,r.skillActivations])}]))}));
    return {case:test.name,exposure:test.exposure ?? 'Both recorded outcomes known before these diagnostic runs.',input,observed,predictions};
  });
  for(const [path,digest] of Object.entries(protocol.sourceHashes))assert.equal(hash(readFileSync(join(root,path))),digest,`Engine changed during replay:${path}`);
  writeFileSync(output,JSON.stringify({generatedAt:new Date().toISOString(),protocolSha256:hash(readFileSync(join(dir,'protocol.json'))),scriptSha256:hash(readFileSync(fileURLToPath(import.meta.url))),patches,runtimeHashes,
    validations:['Exact patch anchors; original and changed source hashes retained','Past per-run snapshot only; no battle troop state mutation','One uncancelled source normal attack each round in both captures','Every S3 army term verified against the selected count snapshot','Every non-S3 army term verified against delivery count','Production source hashes checked before and after'],results},null,2)+'\n',{flag:'wx'});
} finally {rmSync(temporary,{recursive:true,force:true});}
