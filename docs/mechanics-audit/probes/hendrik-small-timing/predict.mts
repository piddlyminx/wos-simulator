import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const dir=dirname(fileURLToPath(import.meta.url));
if(!process.argv[2])throw new Error('Usage: predict.mts NEW_OUTPUT_JSON [STATS_INPUT_JSON]');
const output=resolve(process.argv[2]);
if(output===dir||output.startsWith(dir+sep)||existsSync(output))throw new Error('Output must be a new file outside the frozen package');
const read=(name:string)=>JSON.parse(readFileSync(join(dir,name),'utf8'));
const hash=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
const manifest=read('manifest.json');
for(const[name,expected]of Object.entries(manifest.artifacts))if(hash(readFileSync(join(dir,name)))!==expected)throw new Error(`Changed frozen artifact: ${name}`);
if(hash(readFileSync(join(dir,'runtime.tar.gz')))!==manifest.archive_sha256)throw new Error('Changed frozen runtime archive');
const input=read('input.json'),variants=read('variants.json');
if(process.argv[3]){const fresh=JSON.parse(readFileSync(resolve(process.argv[3]),'utf8'));for(const side of['attacker','defender']){if(!fresh[side]?.stats)throw new Error(`Missing ${side}.stats`);input[side].stats=structuredClone(fresh[side].stats);}}
const scratch=mkdtempSync(join(tmpdir(),'wos-hendrik-small-timing-'));
const result:any={generatedAt:new Date().toISOString(),exposure:process.argv[3]?'Post-capture fresh-stat replay, not blinded to observed outcome.':'Replay of frozen formation and candidate models. Original pre-capture prediction is preserved separately; this replay makes no claim of blindness to outcomes.',input,manifest,statsSource:process.argv[3]??'frozen preceding Hendrik report',candidates:{},sensitivity:{}};
try{
 execFileSync('tar',['-xzf',join(dir,'runtime.tar.gz'),'-C',scratch]);
 for(const[name,expected]of Object.entries(manifest.files))if(hash(readFileSync(join(scratch,name)))!==expected)throw new Error(`Changed frozen file: ${name}`);
 const engine=await import(pathToFileURL(join(scratch,'simulator.ts')).href);
 const run=(i:any,c:any,trace=false)=>{const r=engine.runPrepared(engine.prepareBattle(i,c),'hendrik-small-timing',{mode:trace?'trace':'fast'});if(!r.randomness.deterministic)throw new Error('Unexpected chance in deterministic probe');return {score:Object.values(r.remaining.attacker).reduce((a:number,b:any)=>a+b,0)-Object.values(r.remaining.defender).reduce((a:number,b:any)=>a+b,0),rounds:r.rounds,remaining:r.remaining,randomness:r.randomness,...(trace?{skills:r.skillReport.attacker,roundStart:r.trace.rounds.map((v:any)=>({round:v.round,troops:v.roundStartTroops})),attacks:r.attacks}:{} )};};
 const fields=[...['attacker','defender'].flatMap(side=>['inf','lanc','mark'].flatMap(unit=>['attack','defense','lethality','health'].map(stat=>[side,unit,stat])))];
 const vectors:number[][]=[fields.map(()=>0)];
 for(const polarity of[-1,1])vectors.push(fields.map(([side])=>.05*polarity*(side==='attacker'?1:-1)));
 for(let field=0;field<fields.length;field++)for(const polarity of[-1,1])vectors.push(fields.map((_,index)=>index===field?.05*polarity:0));
 let state=202609073;const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
 for(let n=0;n<512;n++)vectors.push(fields.map(()=>.1*random()-.05));
 result.sensitivity={halfWidth:.05,fields,vectors,seed:202609073,scope:'Displayed-stat precision screen, not proof of a complete non-monotonic envelope. Includes two opposing corners, every single-coordinate corner and512 shared random vectors.',results:{}};
 for(const[name,config]of Object.entries(variants)){
  result.candidates[name]=run(input,config,true);
  result.sensitivity.results[name]=vectors.map(delta=>{const i=structuredClone(input);fields.forEach(([side,unit,stat],j)=>i[side].stats[unit][stat]+=delta[j]);return run(i,config);});
 }
 writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({output,candidates:Object.fromEntries(Object.entries(result.candidates).map(([name,r]:any)=>[name,{score:r.score,rounds:r.rounds,remaining:r.remaining,range:[Math.min(...result.sensitivity.results[name].map((v:any)=>v.score)),Math.max(...result.sensitivity.results[name].map((v:any)=>v.score))],roundsSeen:[...new Set(result.sensitivity.results[name].map((v:any)=>v.rounds))]}]))},null,2));
}finally{rmSync(scratch,{recursive:true,force:true});}
