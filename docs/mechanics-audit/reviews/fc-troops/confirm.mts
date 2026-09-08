import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {BatchWorkerPool} from '../../../../simulator/src/workerPool';
import {WorkerThreadBatchWorker} from '../../../../scripts/workerThreadBatchWorker';
import {compareOutcomeDistribution} from '../../../../simulator/src/tooling/parityMetrics';

const source=JSON.parse(readFileSync(new URL('./results.json',import.meta.url),'utf8'));
const config=JSON.parse(readFileSync(new URL('./config-snapshot.json',import.meta.url),'utf8'));
const output=process.argv[2] ?? new URL('./confirmation.json',import.meta.url);
assert(!existsSync(output),'Preserve confirmation output');
const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
for(const [path,sha] of Object.entries(source.sourceHashes))assert.equal(hash(path),sha,`Engine changed:${path}`);
const pool=new BatchWorkerPool(4,()=>new WorkerThreadBatchWorker(new URL('./worker.mts',import.meta.url)));
const selection=[{key:'s4-fc9-gatot-90000.json#0',names:['current','no_body_defense']},
  {key:'s8-25000-t9-marksmen-vs-one-t1-fc10-infantry.json#0',names:['current','volley_extra_skill']}];
const total=(fighter:any)=>Object.values(fighter.troops).reduce((sum:number,value:any)=>sum+value,0);
try{
  const results=await Promise.all(selection.map(async selected=>{
    const row=source.results.find((r:any)=>r.key.endsWith(selected.key));assert(row);
    const predictions=Object.fromEntries(await Promise.all(selected.names.map(async name=>{
      const variant=structuredClone(config);
      if(name==='no_body_defense')delete variant.troopSkills.skills.BodyOfLight.effects['BodyOfLight/1'];
      if(name==='volley_extra_skill')variant.troopSkills.skills.Volley.effects['Volley/1']={type:'extra_skill_attack',value:[100],units:{applies_to:'trigger.source',applies_vs:'trigger.target'},trigger_damage_jobs:[{source:'use.source',target:'use.target'}]};
      const result:any=await pool.runTask({input:row.input,config:variant,repeat:10000,seed:`fc-troop-evidence-confirmation-2026-09-07:${row.key}`});
      const comparison=compareOutcomeDistribution({candidate:{samples:result.samples},reference:{samples:row.game},initialTroops:total(row.input.attacker)+total(row.input.defender),
        outcomeRange:{min:-total(row.input.defender),max:total(row.input.attacker)},deterministic:result.deterministic});
      console.log(JSON.stringify({key:row.key,name,comparison,winnerCounts:result.winnerCounts,roundLimitCount:result.roundLimitCount}));
      return [name,{...result,comparison}];
    })));
    return {key:row.key,game:row.game,predictions};
  }));
  for(const [path,sha] of Object.entries(source.sourceHashes))assert.equal(hash(path),sha,`Engine changed:${path}`);
  writeFileSync(output,JSON.stringify({generatedAt:new Date().toISOString(),repeat:10000,seed:'fc-troop-evidence-confirmation-2026-09-07:<fixture-key>#<replicate>',
    selectionReason:'Independent10k confirmation of the borderline BodyOfLight Defense omission and the prior Volley25000 tail/delivery comparison. Other clearly separated or overlapping candidates are not repeatedly sampled.',sourceHashes:source.sourceHashes,results},null,2)+'\n',{flag:'wx'});
}finally{await pool.close();}
