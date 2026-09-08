import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const dir=dirname(fileURLToPath(import.meta.url)),probe=resolve(dir,'../../probes/reina-shadowblade');
assert(process.argv[2],'Usage: replay.mts NEW_OUTPUT_JSON');const output=resolve(process.argv[2]);assert(!existsSync(output),'Preserve existing output');
const hash=(x:Buffer|string)=>createHash('sha256').update(x).digest('hex');
const read=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const config=read(join(probe,'config-snapshot.json')),input=read(join(probe,'capture-01/captured-input.json')),manifest=read(join(probe,'manifest.json'));
const protocol=read(join(dir,'protocol.json'));assert.equal(hash(readFileSync(join(probe,'config-snapshot.json'))),protocol.config_sha256);assert.equal(hash(readFileSync(join(probe,'capture-01/captured-input.json'))),protocol.input_sha256);assert.equal(hash(readFileSync(join(probe,'runtime.tar.gz'))),manifest.archive_sha256);
assert.equal(config.heroDefinitions.Reina.skills.ShadowBlade.effects['ShadowBlade/1'].value[0],20);
const scratch=mkdtempSync(join(tmpdir(),'wos-reina-magnitude-'));
const stats=(xs:number[])=>{const sorted=[...xs].sort((a,b)=>a-b),mean=xs.reduce((a,b)=>a+b,0)/xs.length;return{n:xs.length,mean,sd:Math.sqrt(xs.reduce((n,x)=>n+(x-mean)**2,0)/(xs.length-1)),min:sorted[0],p025:sorted[Math.floor(xs.length*.025)],median:sorted[Math.floor(xs.length*.5)],p975:sorted[Math.floor(xs.length*.975)],max:sorted.at(-1)};};
try{
 execFileSync('tar',['-xzf',join(probe,'runtime.tar.gz'),'-C',scratch]);for(const[name,expected]of Object.entries(manifest.source_files))assert.equal(hash(readFileSync(join(scratch,name))),expected);
 const engine=await import(pathToFileURL(join(scratch,'simulator.ts')).href),results:any={createdAt:new Date().toISOString(),protocol,input,archive_sha256:manifest.archive_sha256,candidates:{}};
 for(const[name,value]of Object.entries({current_extra20:20,whole_extra_attack100:100,base_attack_plus20:120})){
  const c=structuredClone(config);c.heroDefinitions.Reina.skills.ShadowBlade.effects['ShadowBlade/1'].value[0]=value;const prepared=engine.prepareBattle(input,c),samples:any[]=[],traces:any[]=[];
  for(let n=0;n<2048;n++){
   const r=engine.runPrepared(prepared,`reina-shadowblade-${n}`,{mode:n<256?'trace':'fast'});samples.push({score:engine.signedRemainingScore(r),rounds:r.rounds,remaining:r.remaining});
   if(n<256){const jobs=r.attacks.filter((j:any)=>j.sourceEffectId==='ShadowBlade/1'),s3=r.skillReport.attacker.find((s:any)=>s.skillId==='ShadowBlade'),s2=r.skillReport.attacker.find((s:any)=>s.skillId==='SwiftJive');traces.push({seed:n,score:engine.signedRemainingScore(r),s2:s2?.skillActivations??0,s3:s3?.skillActivations??0,s3RawKills:jobs.reduce((sum:number,j:any)=>sum+j.kills,0),jobs:jobs.map((j:any)=>({round:j.round,kills:j.kills,target:j.takerUnit}))});}
  }
  results.candidates[name]={value,score:stats(samples.map(r=>r.score)),rawS3Kills:stats(traces.map(r=>r.s3RawKills)),s3Acts:stats(traces.map(r=>r.s3)),firstGameScore:-166,atOrBelowFirstGame:samples.filter(r=>r.score<=-166).length,atOrAboveFirstGame:samples.filter(r=>r.score>=-166).length,minInfantry:Math.min(...samples.map(r=>r.remaining.defender.infantry)),backlineLossRuns:samples.filter(r=>r.remaining.defender.lancer!==50||r.remaining.defender.marksman!==50).length,samples,traces};
 }
 writeFileSync(output,JSON.stringify(results,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,candidates:Object.fromEntries(Object.entries(results.candidates).map(([name,r]:any)=>[name,{value:r.value,score:r.score,rawS3Kills:r.rawS3Kills,s3Acts:r.s3Acts,atOrBelowFirstGame:r.atOrBelowFirstGame,atOrAboveFirstGame:r.atOrAboveFirstGame,minInfantry:r.minInfantry,backlineLossRuns:r.backlineLossRuns}]))},null,2));
}finally{rmSync(scratch,{recursive:true,force:true});}
