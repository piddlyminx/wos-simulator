import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const dir=dirname(fileURLToPath(import.meta.url)),read=(p:string)=>JSON.parse(readFileSync(p,'utf8')),hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
assert(process.argv[2]&&process.argv[3],'Usage: predict.mts INPUT_JSON NEW_OUTPUT_JSON');const inputPath=resolve(process.argv[2]),output=resolve(process.argv[3]);assert(!existsSync(output));
for(const[name,h]of Object.entries(read(join(dir,'manifest.json'))))assert.equal(hash(readFileSync(join(dir,name))),h,`Frozen ${name} changed`);
const input=read(inputPath),config=read(join(dir,'config-snapshot.json')),spec=read(join(dir,'spec.json')),runtime=read(join(dir,'runtime-manifest.json'));
for(const side of ['attacker','defender']){assert.deepEqual(input[side].heroes,spec[side].heroes);assert.deepEqual(input[side].troops,spec[side].troops);assert.deepEqual(input[side].joiner_heroes??{},{});}
assert.equal(input.engagement_type,undefined);assert.equal(input.maxRounds,undefined);
const variants:any={current:config,no_s2:structuredClone(config)};variants.no_s2.heroDefinitions.Greg.skills.DeterrenceOfLaw.effects['DeterrenceOfLaw/1'].value=[0,0,0,0,0];
const stats=(xs:number[])=>{const sorted=[...xs].sort((a,b)=>a-b),mean=xs.reduce((a,b)=>a+b,0)/xs.length;return{n:xs.length,mean,sd:Math.sqrt(xs.reduce((a,b)=>a+(b-mean)**2,0)/(xs.length-1)),min:sorted[0],p025:sorted[Math.floor(xs.length*.025)],median:sorted[Math.floor(xs.length*.5)],p975:sorted[Math.floor(xs.length*.975)],max:sorted.at(-1)};};
const groups=(xs:number[])=>{let state=777179;const next=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};return Array.from({length:32768},()=>Array.from({length:5},()=>xs[Math.floor(next()*xs.length)]).reduce((a,b)=>a+b,0)/5);};
const scratch=mkdtempSync(join(tmpdir(),'wos-greg-replay-'));
try{
 execFileSync('tar',['-xzf',join(dir,'runtime.tar.gz'),'-C',scratch]);for(const[name,h]of Object.entries(runtime.source_files))assert.equal(hash(readFileSync(join(scratch,name))),h);
 const engine=await import(pathToFileURL(join(scratch,'simulator.ts')).href),results:any={created_at:new Date().toISOString(),exposure:'Replay of supplied stats; this helper does not assert whether outcomes have been seen. The original frozen protocol records pre-capture exposure separately.',input_path:inputPath,input_sha256:hash(readFileSync(inputPath)),input,runtime_archive_sha256:runtime.archive_sha256,candidates:{}};
 for(const[name,c]of Object.entries(variants)){
  const prepared=engine.prepareBattle(input,c),samples:any[]=[],traces:any[]=[];
  for(let n=0;n<4096;n++){
   const r=engine.runPrepared(prepared,`greg-deterrence-${n}`,{mode:n<64?'trace':'fast'});samples.push({score:engine.signedRemainingScore(r),rounds:r.rounds,remaining:r.remaining});
   if(n<64){const incoming=r.attacks.filter((j:any)=>j.dealerSide==='defender');traces.push({seed:n,score:engine.signedRemainingScore(r),incoming_jobs:incoming.length,s2_affected_incoming_jobs:incoming.filter((j:any)=>(j.appliedEffects??[]).some((e:any)=>e.effectId==='DeterrenceOfLaw/1')).length,skillReport:r.skillReport});}
  }
  const scores=samples.map(s=>s.score),cornerRows:any[]=[];
  for(let seed=0;seed<8;seed++)for(let mask=0;mask<256;mask++){
   const i=structuredClone(input);let bit=0;for(const[side,unit]of [['attacker','inf'],['defender','mark']])for(const stat of ['attack','defense','lethality','health'])i[side].stats[unit][stat]+=(mask&(1<<bit++))?.05:-.05;
   const r=engine.runPrepared(engine.prepareBattle(i,c),`greg-deterrence-${seed}`,{mode:'fast'});cornerRows.push({seed,mask,score:engine.signedRemainingScore(r),rounds:r.rounds,remaining:r.remaining});
  }
  results.candidates[name]={score:stats(scores),five_battle_mean:stats(groups(scores)),rounds:stats(samples.map(s=>s.rounds)),samples,traces,precision:{description:'All256 corners of8 used reported stats at±0.05 across8 fixed seeds; paired sensitivity screen, not a proof of the full non-monotonic envelope.',max_absolute_score_shift:Math.max(...cornerRows.map(r=>Math.abs(r.score-samples[r.seed].score))),rows:cornerRows}};
 }
 writeFileSync(output,JSON.stringify(results,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,candidates:Object.fromEntries(Object.entries(results.candidates).map(([name,v]:any)=>[name,{score:v.score,five_battle_mean:v.five_battle_mean,precision_max_shift:v.precision.max_absolute_score_shift}]))},null,2));
}finally{rmSync(scratch,{recursive:true,force:true});}
