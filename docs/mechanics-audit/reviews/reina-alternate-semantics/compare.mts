import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {compareOutcomeDistribution} from '../../../../simulator/src/tooling/parityMetrics.ts';
const dir=dirname(fileURLToPath(import.meta.url)),root=resolve(dir,'../../../..'),read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const source=read(join(dir,'predictions.json')),output=resolve(process.argv[2]??join(dir,'parity.json'));assert(!existsSync(output));
const results:any={createdAt:new Date().toISOString(),predictions_sha256:createHash('sha256').update(readFileSync(join(dir,'predictions.json'))).digest('hex'),comparison:'Current repository CDF/support test; reference observations read after fixed simulator predictions were saved. No stat adjustment or deduplication.',cases:[]};
for(const c of source.cases){
 const[p,i]=c.key.split('::'),raw=read(join(root,p)),entry=Array.isArray(raw)?raw[+i]:raw;
 const rows=Array.isArray(entry.game_report_result)?entry.game_report_result:[entry.game_report_result],observed=rows.map((r:any)=>r.attacker-r.defender);
 const count=(side:string)=>(Object.values(c.input[side].troops) as number[]).reduce((a,b)=>a+b,0),a=count('attacker'),d=count('defender');
 const item:any={key:c.key,observed_scores:observed,candidates:{}};
 for(const[name,result]of Object.entries(c.candidates) as any){
  const metric=compareOutcomeDistribution({candidate:{samples:result.scores},reference:{samples:observed},initialTroops:a+d,outcomeRange:{min:-d,max:a},deterministic:result.score.sd===0});
  item.candidates[name]=metric;
 }
 results.cases.push(item);console.log(JSON.stringify({key:c.key,observed_scores:observed,candidates:Object.fromEntries(Object.entries(item.candidates).map(([k,v]:any)=>[k,{p:v.p,passes:v.passes,mean:v.mu_candidate,sd:v.sigma_candidate}]))}));
}
writeFileSync(output,JSON.stringify(results,null,2)+'\n',{flag:'wx'});
