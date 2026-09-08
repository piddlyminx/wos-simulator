import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const dir=dirname(fileURLToPath(import.meta.url));
if(!process.argv[2])throw new Error('Usage: replay.mts NEW_OUTPUT_JSON [STATS_INPUT_JSON]');
const output=resolve(process.argv[2]);
if(output===dir||output.startsWith(dir+sep)||existsSync(output))throw new Error('Output must be a new file outside the frozen probe package');
if(process.argv[3]&&output===resolve(process.argv[3]))throw new Error('Output must differ from supplied stats input');
const read=(name:string)=>JSON.parse(readFileSync(join(dir,name),'utf8'));
const hash=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
const manifest=read('runtime-manifest.json'),frozen=read('prediction.json'),spec=read('spec.json');
for(const[name,expected]of Object.entries(spec.artifacts_sha256))if(hash(readFileSync(join(dir,name)))!==expected)throw new Error(`Frozen artifact changed: ${name}`);
if(hash(readFileSync(join(dir,'original-runtime.tar.gz')))!==manifest.archive_sha256)throw new Error('Frozen runtime archive changed');
const input=read('input.json');
if(process.argv[3]){
 const supplied=JSON.parse(readFileSync(resolve(process.argv[3]),'utf8'));
 for(const side of['attacker','defender']){
  if(!supplied[side]?.stats)throw new Error(`Stats input must contain ${side}.stats`);
  input[side].stats=structuredClone(supplied[side].stats);
 }
}
const scratch=mkdtempSync(join(tmpdir(),'wos-gwen-onset-replay-'));
const result:any={generatedAt:new Date().toISOString(),phase:'frozen_formation_replay',outcome_exposure:'This replay makes no claim of blindness to a game outcome. It uses the preserved formation/config with frozen or explicitly supplied stats. The original prospective prediction remains separate.',stats_source:process.argv[3]?resolve(process.argv[3]):'frozen input.json',input,archive_sha256:manifest.archive_sha256,results:{}};
try{
 const original=join(scratch,'original'),fractional=join(scratch,'noOuter');mkdirSync(original);
 execFileSync('tar',['-xzf',join(dir,'original-runtime.tar.gz'),'-C',original]);
 for(const[name,expected]of Object.entries(manifest.files))if(hash(readFileSync(join(original,name)))!==expected)throw new Error(`Frozen runtime file changed: ${name}`);
 cpSync(original,fractional,{recursive:true});
 const patch=manifest.no_outer_patch,path=join(fractional,patch.file),source=readFileSync(path,'utf8');
 if(source.split(patch.before).length!==2)throw new Error('Expected one outer-ceiling expression');
 const replacement=source.replace(patch.before,patch.after);
 if(hash(replacement)!==patch.result_sha256)throw new Error('Patched runtime hash differs');
 writeFileSync(path,replacement);
 for(const[engineName,location]of Object.entries({current:original,noOuter:fractional})){
  const engine=await import(pathToFileURL(join(location,'simulator.ts')).href);result.results[engineName]={};
  for(const[name,config]of Object.entries(frozen.variants)){
   const r=engine.runPrepared(engine.prepareBattle(input,config),'gwen-short-onset-replay',{mode:'trace'});
   result.results[engineName][name]={score:engine.signedRemainingScore(r),rounds:r.rounds,remaining:r.remaining,skills:r.skillReport.attacker.filter((s:any)=>s.sourceKind==='hero_skill'),roundStart:r.trace.rounds.map((q:any)=>({round:q.round,troops:q.roundStartTroops})),jobs:r.attacks.filter((a:any)=>a.dealerSide==='attacker').map((a:any)=>({round:a.round,id:a.sourceEffectId,target:a.takerUnit,kills:a.kills})),randomness:r.randomness};
  }
 }
 writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(output);
}finally{rmSync(scratch,{recursive:true,force:true});}
