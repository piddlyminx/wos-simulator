import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const dir=dirname(fileURLToPath(import.meta.url));
assert(process.argv[2]&&process.argv[3],'Usage: predict.mts INPUT_JSON NEW_OUTPUT_JSON [prospective]');
const inputPath=resolve(process.argv[2]),outputPath=resolve(process.argv[3]),prospective=process.argv[4]==='prospective';
assert(!existsSync(outputPath)&&outputPath!==inputPath,'Preserve existing files; choose a new output');
if(prospective){assert.equal(inputPath,join(dir,'estimated-input.json'));assert.equal(outputPath,join(dir,'prediction.json'));}
const read=(name:string)=>JSON.parse(readFileSync(join(dir,name),'utf8'));
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const manifest=read('manifest.json'),spec=read('spec.json'),config=read('config-snapshot.json'),definitions=read('candidates.json');
for(const[name,expected]of Object.entries(manifest.guarded_artifacts))assert.equal(hash(readFileSync(join(dir,name))),expected,`Frozen artifact changed: ${name}`);
assert.equal(hash(readFileSync(join(dir,'runtime.tar.gz'))),manifest.archive_sha256,'Frozen runtime archive changed');
const input=JSON.parse(readFileSync(inputPath,'utf8'));
for(const side of['attacker','defender']){
 assert.deepEqual(input[side].heroes,spec[side].heroes,`${side} full kit changed`);
 assert.deepEqual(input[side].troops,spec[side].troops,`${side} troop formation changed`);
 assert.deepEqual(input[side].joiner_heroes??{},{},'No joiners in this probe');
}
assert.equal(input.engagement_type??'solo','solo');assert.equal(input.maxRounds??1500,1500);
const fields=[['attacker','lanc'],['defender','inf'],['defender','lanc'],['defender','mark']].flatMap(([s,u])=>['attack','defense','lethality','health'].map(t=>[s,u,t]));
for(const[s,u,t]of fields)assert(Number.isFinite(input[s].stats[u][t]),`Missing ${s}.${u}.${t}`);
function stats(xs:number[]){const a=xs.slice().sort((a,b)=>a-b),mean=xs.reduce((a,b)=>a+b,0)/xs.length;return{n:xs.length,mean,sd:Math.sqrt(xs.reduce((a,b)=>a+(b-mean)**2,0)/(xs.length-1)),min:a[0],p025:a[Math.floor(a.length*.025)],p05:a[Math.floor(a.length*.05)],median:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],p975:a[Math.floor(a.length*.975)],max:a.at(-1)};}
let state=2026090711;const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
const vectors=Array.from({length:256},()=>fields.map(()=>(random()-.5)*.1));
for(let f=0;f<fields.length;f++)for(const sign of[-1,1])vectors.push(fields.map((_,j)=>j===f?sign*.05:0));
for(const sign of[-1,1])vectors.push(fields.map(([side])=>sign*(side==='attacker'?1:-1)*.05));
const scratch=mkdtempSync(join(tmpdir(),'wos-reina-shadowblade-'));
const output:any={generatedAt:new Date().toISOString(),phase:prospective?'prospective_conditional_prediction':'frozen_formation_replay',outcome_exposure:prospective?'No new full-kit Reina1/1/1 game outcome has been seen. Earlier S3-locked fixture inputs and simulator-only formation screening informed this design.':'Replay using caller-supplied inputs and frozen behavior. This makes no claim of blindness to game outcomes; original prospective predictions remain separate.',stats_provenance:prospective?'Observed WIP nohero Lancer report stats copied as a conditional starting point, not a fresh Reina measurement. Selecting Reina can change Attack/Defense and equipment can change other fields. Exact captured report stats are required; no generation bonus is added.':'Caller-supplied report-resolved stats. Verify report identity and setup; no generation bonus is added.',input,inputPath,inputSha256:hash(readFileSync(inputPath)),archive_sha256:manifest.archive_sha256,candidateDefinitions:definitions,randomSeeds:{endpoint:'reina-shadowblade-0 through2047',trace:'first256 endpoint seeds',precision:'first290 endpoint seeds with shared offsets',fiveBattleBootstrap:2026090711},precision:{halfWidth:.05,fields,vectors,note:'Paired290-vector sensitivity screen, not an exhaustive bound or allowance for unknown hero/account changes.'},candidates:{}};
try{
 const runtime=join(scratch,'runtime');mkdirSync(runtime);execFileSync('tar',['-xzf',join(dir,'runtime.tar.gz'),'-C',runtime]);
 for(const[name,expected]of Object.entries(manifest.source_files))assert.equal(hash(readFileSync(join(runtime,name))),expected,`Runtime file changed: ${name}`);
 const engine=await import(pathToFileURL(join(runtime,'simulator.ts')).href);
 for(const[name,definition]of Object.entries(definitions)as any){
  const c=structuredClone(config);
  for(const patch of definition.patches){const target=patch.path.slice(0,-1).reduce((v:any,k:any)=>v[k],c),key=patch.path.at(-1);assert.deepEqual(target[key]??null,patch.from);target[key]=structuredClone(patch.to);}
  const prepared=engine.prepareBattle(input,c),samples:any[]=[],traces:any[]=[];
  for(let seed=0;seed<2048;seed++){
   const r=engine.runPrepared(prepared,`reina-shadowblade-${seed}`,{mode:seed<256?'trace':'fast'});
   samples.push({score:engine.signedRemainingScore(r),rounds:r.rounds,attacker:r.remaining.attacker.lancer,infantry:r.remaining.defender.infantry,lancer:r.remaining.defender.lancer,marksman:r.remaining.defender.marksman});
   if(seed<256){
    const s3=r.skillReport.attacker.find((s:any)=>s.skillId==='ShadowBlade'),s2=r.skillReport.attacker.find((s:any)=>s.skillId==='SwiftJive');
    const jobs=r.attacks.filter((a:any)=>a.sourceEffectId==='ShadowBlade/1');
    traces.push({seed,rounds:r.rounds,score:engine.signedRemainingScore(r),s2Activations:s2?.skillActivations??0,s3Activations:s3?.skillActivations??0,s3RawKills:jobs.reduce((n:number,j:any)=>n+j.kills,0),s3Jobs:jobs.length,targets:[...new Set(jobs.map((j:any)=>j.takerUnit))]});
   }
  }
  const varied=vectors.map((vector,seed)=>{const i=structuredClone(input);fields.forEach(([s,u,t],f)=>i[s].stats[u][t]+=vector[f]);const r=engine.runPrepared(engine.prepareBattle(i,c),`reina-shadowblade-${seed}`,{mode:'fast'});return{score:engine.signedRemainingScore(r),delta:engine.signedRemainingScore(r)-samples[seed].score,infantry:r.remaining.defender.infantry,rounds:r.rounds};});
  const batchMeans=Array.from({length:16384},()=>Array.from({length:5},()=>samples[Math.floor(random()*samples.length)].score).reduce((a,b)=>a+b,0)/5);
  const row={score:stats(samples.map(s=>s.score)),remainingInfantry:stats(samples.map(s=>s.infantry)),backlineLoss:stats(samples.map(s=>100-s.lancer-s.marksman)),rounds:stats(samples.map(s=>s.rounds)),attackerWins:samples.filter(s=>s.attacker>0&&s.infantry===0&&s.lancer===0&&s.marksman===0).length,fiveBattleMeanScore:stats(batchMeans),s3Activations:stats(traces.map(t=>t.s3Activations)),s3RawKills:stats(traces.map(t=>t.s3RawKills)),zeroS3Activations:traces.filter(t=>t.s3Activations===0).length,precision:{count:varied.length,pairedScoreDelta:stats(varied.map(r=>r.delta)),changedOutcomes:varied.filter(r=>r.delta!==0).length,minDefenderInfantry:Math.min(...varied.map(r=>r.infantry))},samples,traces,precisionSamples:varied};
  output.candidates[name]=row;
 }
 writeFileSync(outputPath,JSON.stringify(output,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({outputPath,candidates:Object.fromEntries(Object.entries(output.candidates).map(([n,r]:any)=>[n,{score:r.score,backlineLoss:r.backlineLoss,fiveBattleMeanScore:r.fiveBattleMeanScore,s3Activations:r.s3Activations,s3RawKills:r.s3RawKills,precision:r.precision}]))},null,2));
}finally{rmSync(scratch,{recursive:true,force:true});}
