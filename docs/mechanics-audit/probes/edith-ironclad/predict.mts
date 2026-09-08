import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const dir=dirname(fileURLToPath(import.meta.url)),read=(p:string)=>JSON.parse(readFileSync(p,'utf8')),hash=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
assert(process.argv[2]&&process.argv[3],'Usage: predict.mts INPUT_JSON NEW_OUTPUT_JSON');
const inputPath=resolve(process.argv[2]),output=resolve(process.argv[3]);assert(!existsSync(output),'Preserve existing output');
const manifest=read(join(dir,'manifest.json'));for(const[name,h]of Object.entries(manifest))assert.equal(hash(readFileSync(join(dir,name))),h,`Frozen ${name} changed`);
const config=read(join(dir,'config-snapshot.json')),input=read(inputPath),spec=read(join(dir,'spec.json')),runtimeManifest=read(join(dir,'runtime-manifest.json'));
for(const side of ['attacker','defender']){assert.deepEqual(input[side].heroes,spec[side].heroes);assert.deepEqual(input[side].troops,spec[side].troops);assert.deepEqual(input[side].joiner_heroes??{},{});}
assert.equal(input.engagement_type,undefined);assert.equal(input.maxRounds,undefined);
const configs:any={};for(const name of Object.keys(read(join(dir,'candidates.json')))){
 const c=structuredClone(config),s=c.heroDefinitions.Edith.skills;
 if(name==='no_s2')s.Ironclad.effects['Ironclad/1'].value=[0,0,0,0,0];
 if(name==='s2_health')s.Ironclad.effects['Ironclad/1'].type='active.hero.health.up';
 if(name==='s2_defense')s.Ironclad.effects['Ironclad/1'].type='active.hero.defense.up';
 if(name==='no_s3')s.SteelSentinel.effects['SteelSentinel/1'].value=[0,0,0,0,0];configs[name]=c;
}
const scratch=mkdtempSync(join(tmpdir(),'wos-edith-replay-'));
try{
 execFileSync('tar',['-xzf',join(dir,'runtime.tar.gz'),'-C',scratch]);for(const[name,h]of Object.entries(runtimeManifest.source_files))assert.equal(hash(readFileSync(join(scratch,name))),h);
 const engine=await import(pathToFileURL(join(scratch,'simulator.ts')).href),result:any={createdAt:new Date().toISOString(),exposure:'Replay of supplied input; this helper does not assert whether a game outcome has been seen. Refer to the frozen design protocol and recorded capture chronology.',input_path:inputPath,input_sha256:hash(readFileSync(inputPath)),input,runtime_archive_sha256:runtimeManifest.archive_sha256,candidates:{}};
 for(const[name,c]of Object.entries(configs)){
  const run=(i:any,trace=false)=>engine.runPrepared(engine.prepareBattle(i,c),'edith-ironclad-design',{mode:trace?'trace':'fast'}),r=run(input,true);assert(r.randomness.deterministic);
  const uses:any={};for(const job of r.attacks)for(const effect of job.appliedEffects??[])if(effect.effectId.startsWith('Ironclad/')||effect.effectId.startsWith('SteelSentinel/')||effect.effectId.startsWith('StrategicBalance/')){const key=`${effect.effectId}:${job.kind}:${job.takerUnit}`;uses[key]=(uses[key]??0)+1;}
  const scores:number[]=[];
  for(let mask=0;mask<256;mask++){const i=structuredClone(input);let bit=0;for(const[side,unit]of [['attacker','inf'],['defender','mark']])for(const stat of ['attack','defense','lethality','health'])i[side].stats[unit][stat]+=(mask&(1<<bit++))?.05:-.05;scores.push(engine.signedRemainingScore(run(i)));}
  result.candidates[name]={score:engine.signedRemainingScore(r),winner:r.winner,rounds:r.rounds,remaining:r.remaining,deterministic:r.randomness.deterministic,skillReport:r.skillReport,effectJobApplications:uses,precision_corners:{n:scores.length,min:Math.min(...scores),max:Math.max(...scores),max_absolute_shift:Math.max(...scores.map(x=>Math.abs(x-engine.signedRemainingScore(r)))),scores}};
 }
 writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,candidates:Object.fromEntries(Object.entries(result.candidates).map(([k,v]:any)=>[k,{score:v.score,rounds:v.rounds,precision:[v.precision_corners.min,v.precision_corners.max],uses:v.effectJobApplications}]))},null,2));
}finally{rmSync(scratch,{recursive:true,force:true});}
