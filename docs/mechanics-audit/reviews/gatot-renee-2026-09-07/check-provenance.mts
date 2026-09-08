import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {prepareBattle} from '../../../../simulator/src/simulator';
const dir=dirname(fileURLToPath(import.meta.url)),cases=JSON.parse(readFileSync(resolve(dir,'cases.json'),'utf8')),config=JSON.parse(readFileSync(resolve(dir,'config.json'),'utf8'));
function canonical(value:any):any{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).filter(k=>!['name','diagnostics'].includes(k)).sort().map(k=>[k,canonical(value[k])]));return value;}
const groups:Record<string,string[]>={},rows:any=[];
for(const [key,c]of Object.entries(cases)as any){const prepared=prepareBattle(c.input,config),signature=JSON.stringify(canonical({fighters:prepared.fighters,passive:{attacker:c.input.attacker.passive??{},defender:c.input.defender.passive??{}},maxRounds:c.input.maxRounds??1500,engagement:c.input.engagement_type??'solo'})),digest=createHash('sha256').update(signature).digest('hex');
 (groups[digest]??=[]).push(key);
 const metadata=c.entry?.metadata??{},identityEntries:any[]=[];
 function ids(value:any,path=''){if(!value||typeof value!=='object')return;for(const[k,v]of Object.entries(value)){const p=path?`${path}.${k}`:k;if(/mail_?id|report_?id|timestamp|battle_?time|captured_?at/i.test(k))identityEntries.push({path:p,value:v});if(typeof v==='object')ids(v,p);}}
 ids(metadata);rows.push({key,battleInputSignature:digest,recordedOutcomeCount:Array.isArray(c.game)?c.game.length:1,reportIdentityFields:identityEntries,independence:'Recorded outcome records; separate battles not established merely by separate paths or repeated numeric rows.'});
}
const duplicateGroups=Object.entries(groups).filter(([,keys])=>keys.length>1).map(([signature,keys])=>({signature,keys}));
writeFileSync(resolve(dir,'provenance-check.json'),JSON.stringify({normalization:'Full simulator-resolved fighters, actual passives, round cap and engagement, excluding display names/diagnostics; source skills and exact tier/FC troop definitions retained. Equality finds semantically identical inputs, not proof of a copied or independent battle.',entries:rows,duplicateInputGroups:duplicateGroups,statisticalGrouping:'Each stored fixture/entry remains a separate comparison; never pool outcome records across source files to increase sample size. Repeated records within a fixture are accepted as recorded; absent report identities leave independence unverified. Preserve duplicate/ambiguous records without deletion.'},null,2)+'\n');
console.log(JSON.stringify({entries:rows.length,duplicateInputGroups:duplicateGroups,identityFields:rows.filter((r:any)=>r.reportIdentityFields.length>0)}));
