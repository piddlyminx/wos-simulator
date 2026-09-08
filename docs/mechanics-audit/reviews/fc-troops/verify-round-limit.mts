import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {prepareBattle,runPrepared,signedRemainingScore} from '../../../../simulator/src/simulator';

const source=JSON.parse(readFileSync(new URL('./results.json',import.meta.url),'utf8'));
for(const [path,sha] of Object.entries(source.sourceHashes)) {
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),sha,`Engine changed:${path}`);
}
const config=JSON.parse(readFileSync(new URL('./config-snapshot.json',import.meta.url),'utf8'));
const rows=source.results.filter((row:any)=>row.key.includes('/s8-'));
const results=rows.flatMap((row:any)=>Object.entries(row.predictions).flatMap(([name,prediction]:[string,any])=>{
  const index=prediction.samples.indexOf(0);
  if(index<0)return [];
  const variant=structuredClone(config);
  if(name==='no_volley')delete variant.troopSkills.skills.Volley;
  if(name==='volley_extra_skill')variant.troopSkills.skills.Volley.effects['Volley/1']={type:'extra_skill_attack',value:[100],units:{applies_to:'trigger.source',applies_vs:'trigger.target'},trigger_damage_jobs:[{source:'use.source',target:'use.target'}]};
  const fixture=JSON.parse(readFileSync(row.key.split('#')[0],'utf8'))[0];
  const seed=`${source.options.seed}:${fixture.test_id}#${index}`;
  const result=runPrepared(prepareBattle(row.input,variant),seed,{mode:'fast'});
  assert.equal(signedRemainingScore(result),0);
  return [{key:row.key,variant:name,index,seed,winner:result.winner,rounds:result.rounds,remaining:result.remaining}];
}));
const output=new URL('./round-limit-verification.json',import.meta.url);
const text=JSON.stringify({source:'results.json',sourceHashes:source.sourceHashes,results},null,2)+'\n';
if(existsSync(output))assert.equal(readFileSync(output,'utf8'),text);
else writeFileSync(output,text,{flag:'wx'});
console.log(JSON.stringify(results));
