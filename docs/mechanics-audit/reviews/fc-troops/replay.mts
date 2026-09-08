import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSimulatorConfig } from '../../../../simulator/src/config-node';
import { adaptTestcaseEntry } from '../../../../simulator/src/tooling/testcases';
import { compareOutcomeDistribution } from '../../../../simulator/src/tooling/parityMetrics';
import { BatchWorkerPool } from '../../../../simulator/src/workerPool';
import { WorkerThreadBatchWorker } from '../../../../scripts/workerThreadBatchWorker';

const dir=dirname(fileURLToPath(import.meta.url)),root=resolve(dir,'../../../..');
const outputPath=resolve(process.argv[2] ?? resolve(dir,'results.json'));
assert(!existsSync(outputPath),'Preserve prior review; use a new output path');
const digest=(path:string)=>createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex');
const sourcePaths=readdirSync(resolve(root,'simulator/src'),{recursive:true}).map(String)
  .filter(path=>path.endsWith('.ts')&&!path.endsWith('.test.ts')).map(path=>`simulator/src/${path}`);
const sourceHashes=Object.fromEntries(sourcePaths.map(path=>[path,digest(path)]));
const config=loadSimulatorConfig();
const configText=JSON.stringify(config,null,2)+'\n';
if (!existsSync(resolve(dir,'config-snapshot.json'))) writeFileSync(resolve(dir,'config-snapshot.json'),configText,{flag:'wx'});
else assert.equal(readFileSync(resolve(dir,'config-snapshot.json'),'utf8'),configText,'Config changed; preserve a separate review package');
const variants:Record<string,any>={current:config};
const definitions:Record<string,string>={current:'Current engine after removal of outer army-term ceiling; unchanged troop definitions.'};
function variant(name:string,description:string,change:(config:any)=>void) {
  variants[name]=structuredClone(config);change(variants[name]);definitions[name]=description;
}
variant('no_crystal_shield','Remove only CrystalShield definition.',c=>delete c.troopSkills.skills.CrystalShield);
variant('crystal_shield_25','Change level2 CrystalShield chance37.5% to25%; other levels/values unchanged.',c=>c.troopSkills.skills.CrystalShield.trigger.probability[1]=25);
variant('crystal_shield_raw36','Change only CrystalShield effect bucket from percentage reduction to raw post-subtract troop shield36.',c=>c.troopSkills.skills.CrystalShield.effects['CrystalShield/1'].type='active.troop.shield');
variant('no_body_of_light','Remove both BodyOfLight effects.',c=>c.troopSkills.skills.BodyOfLight.effects={});
variant('no_body_defense','Remove only BodyOfLight Defense effect.',c=>delete c.troopSkills.skills.BodyOfLight.effects['BodyOfLight/1']);
variant('no_body_conditional','Remove only BodyOfLight conditional reduction effect.',c=>delete c.troopSkills.skills.BodyOfLight.effects['BodyOfLight/2']);
variant('no_crystal_lance','Remove only CrystalLance definition.',c=>delete c.troopSkills.skills.CrystalLance);
variant('no_incandescent','Remove only IncandescentField definition.',c=>delete c.troopSkills.skills.IncandescentField);
variant('no_volley','Remove only Volley definition.',c=>delete c.troopSkills.skills.Volley);
variant('volley_extra_skill','Replace Volley100% normal-job troop-damage buff with a separate100% skill job against trigger target.',c=>{
  c.troopSkills.skills.Volley.effects['Volley/1']={type:'extra_skill_attack',value:[100],units:{applies_to:'trigger.source',applies_vs:'trigger.target'},trigger_damage_jobs:[{source:'use.source',target:'use.target'}]};
});
const cases=[
  {path:'testcases/4-testcases_no-heroes_infantry_fc5.json',names:['current','no_crystal_shield','crystal_shield_25','crystal_shield_raw36']},
  ...['s4-fc9-gatot-90000','s5-fc9-gatot-lumak-90000'].map(id=>({path:`testcases/gatot_verified/${id}.json`,names:['current','no_body_of_light','no_body_defense','no_body_conditional']})),
  ...['1500','1950','2100','2200','2201','3000'].map(count=>({path:`testcases/gatot_verified/s9-${count}-t9-lancers-vs-146-t1-fc10-lancers.json`,names:['current','no_crystal_lance','no_incandescent']})),
  ...['11548','25000','33452'].map(count=>({path:`testcases/gatot_verified/s8-${count}-t9-marksmen-vs-one-t1-fc10-infantry.json`,names:['current','no_volley','volley_extra_skill']})),
];
const options={repeat:Number(process.argv[3]??1000),seed:'fc-troop-evidence-review-2026-09-07',workers:4};
const pool=new BatchWorkerPool(options.workers,()=>new WorkerThreadBatchWorker(new URL('./worker.mts',import.meta.url)));
const total=(fighter:any)=>Object.values(fighter.troops).reduce((sum:number,count:any)=>sum+count,0);
try {
  const results=await Promise.all(cases.map(async selection=>{
    const entry=JSON.parse(readFileSync(resolve(root,selection.path),'utf8'))[0];
    const input=adaptTestcaseEntry(entry),game=entry.game_report_result.map((row:any)=>row.attacker-row.defender);
    const predictions=Object.fromEntries(await Promise.all(selection.names.map(async name=>{
      const result:any=await pool.runTask({input,config:variants[name],repeat:options.repeat,seed:`${options.seed}:${entry.test_id}`});
      const comparison=compareOutcomeDistribution({candidate:{samples:result.samples},reference:{samples:game},initialTroops:total(input.attacker)+total(input.defender),
        outcomeRange:{min:-total(input.defender),max:total(input.attacker)},deterministic:result.deterministic});
      console.log(JSON.stringify({case:entry.test_id,variant:name,mean:comparison.mu_candidate,sd:comparison.sigma_candidate,p:comparison.p,passes:comparison.passes}));
      return [name,{...result,comparison}];
    })));
    return {key:`${selection.path}#0`,fixtureSha256:digest(selection.path),input,gameOutcomes:entry.game_report_result,game,predictions};
  }));
  for (const [path,sha] of Object.entries(sourceHashes)) assert.equal(digest(path),sha,`Engine changed during review:${path}`);
  writeFileSync(outputPath,JSON.stringify({generatedAt:new Date().toISOString(),options,
    evidenceAcceptance:'All recorded game outcomes accepted by user, regardless of folder, unless explicitly invalid/obsolete. No such flags on selected fixtures.',
    interpretation:'Retrospective diagnostic replay with known outcomes; exact input stats, troop/FC keys and hero kits preserved. Variants are simulator counterfactuals, not game observations. Original baseline retains the preceding outer-ceil arithmetic; this replay records the updated engine.',
    sourceHashes,configSha256:createHash('sha256').update(configText).digest('hex'),variantDefinitions:definitions,results},null,2)+'\n',{flag:'wx'});
}finally{await pool.close();}
