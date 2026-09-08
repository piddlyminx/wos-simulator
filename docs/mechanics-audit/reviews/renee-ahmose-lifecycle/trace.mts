import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareBattle,runPrepared} from '../../../../simulator/src/simulator';
const dir=dirname(fileURLToPath(import.meta.url)),root=resolve(dir,'../../../..');
const read=(path:string)=>JSON.parse(readFileSync(resolve(dir,path),'utf8'));
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const protocol=read('protocol.json'),cases=read('cases.json'),config=read('config.json');
function guard(){for(const[path,sha]of Object.entries(protocol.sourceHashes))assert.equal(hash(readFileSync(resolve(root,path))),sha,path);for(const[path,sha]of Object.entries(protocol.artifacts))assert.equal(hash(readFileSync(resolve(dir,path))),sha,path);}
guard();const output=resolve(dir,'baseline-traces.json');assert(!existsSync(output));
const results=Object.entries(cases).map(([label,c]:any)=>({label,key:c.key,observed:c.game,input:c.input,result:runPrepared(prepareBattle(c.input,config),`renee-ahmose-boundary-2026-09-07:${label}`,{mode:'trace'})}));
guard();writeFileSync(output,JSON.stringify({generatedAt:new Date().toISOString(),protocolSha256:hash(readFileSync(resolve(dir,'protocol.json'))),results},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(results.map(r=>({label:r.label,remaining:r.result.remaining,winner:r.result.winner,rounds:r.result.rounds,traceKeys:Object.keys(r.result.trace??{})}))));
