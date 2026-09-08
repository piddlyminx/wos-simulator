import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const dir=dirname(fileURLToPath(import.meta.url)),root=resolve(dir,'../../../..'),probe=join(root,'docs/mechanics-audit/probes/reina-shadowblade');
const output=resolve(process.argv[2]??join(dir,'predictions.json'));assert(!existsSync(output));
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const manifest=read(join(probe,'manifest.json')),base=read(join(probe,'config-snapshot.json')),inputs=read(join(dir,'inputs.json'));
assert.equal(hash(readFileSync(join(probe,'runtime.tar.gz'))),manifest.archive_sha256);
assert.equal(base.heroDefinitions.Reina.skills.ShadowBlade.effects['ShadowBlade/1'].value[0],20);
const configs:any={};
for(const name of ['extra20_current_dodge','extra120_current_dodge','extra20_normal_kind','extra20_shared_round_dodge','extra20_reactive_round_dodge']){
 const c=structuredClone(base),s=c.heroDefinitions.Reina.skills,eff=s.SwiftJive.effects['SwiftJive/1'];
 if(name==='extra120_current_dodge')s.ShadowBlade.effects['ShadowBlade/1'].value=[120,140,160,180,200];
 if(name==='extra20_normal_kind')s.ShadowBlade.effects['ShadowBlade/1'].trigger_damage_jobs[0].damage_kind='normal';
 if(name==='extra20_shared_round_dodge'){
  s.SwiftJive.trigger={type:'turn',probability:s.SwiftJive.trigger.probability};
  eff.units={applies_to:'all',applies_vs:'any'};eff.duration={turns:{count:1}};
 }
 if(name==='extra20_reactive_round_dodge'){
  eff.units={applies_to:'target',applies_vs:'any'};eff.duration={turns:{count:1}};
 }
 configs[name]=c;
}
const summary=(xs:number[])=>{const s=[...xs].sort((a,b)=>a-b),mean=xs.reduce((a,b)=>a+b,0)/xs.length;return{n:s.length,mean,sd:Math.sqrt(xs.reduce((a,b)=>a+(b-mean)**2,0)/(s.length-1)),min:s[0],p025:s[Math.floor(s.length*.025)],median:s[Math.floor(s.length*.5)],p975:s[Math.floor(s.length*.975)],max:s.at(-1)};};
const scratch=mkdtempSync(join(tmpdir(),'wos-reina-scope-'));
try{
 execFileSync('tar',['-xzf',join(probe,'runtime.tar.gz'),'-C',scratch]);
 for(const[name,expected]of Object.entries(manifest.source_files))assert.equal(hash(readFileSync(join(scratch,name))),expected);
 const engine=await import(pathToFileURL(join(scratch,'simulator.ts')).href);
 const result:any={createdAt:new Date().toISOString(),protocol:read(join(dir,'protocol.json')),archive_sha256:manifest.archive_sha256,config_sha256:hash(readFileSync(join(probe,'config-snapshot.json'))),input_sha256:hash(readFileSync(join(dir,'inputs.json'))),variants:Object.fromEntries(Object.entries(configs).map(([k,v]:any)=>[k,v.heroDefinitions.Reina])),cases:[]};
 for(const row of inputs){
  const item:any={key:row.key,input:row.input,candidates:{}};
  for(const[name,config]of Object.entries(configs)){
   const prepared=engine.prepareBattle(row.input,config),scores:number[]=[],traces:any[]=[];
   for(let n=0;n<2048;n++){
    const r=engine.runPrepared(prepared,`reina-shadowblade-${n}`,{mode:n<4?'trace':'fast'});scores.push(engine.signedRemainingScore(r));
    if(n<4)traces.push({seed:n,rounds:r.rounds,score:scores.at(-1),dodgeJobs:r.attacks.filter((j:any)=>j.cancelledBy==='dodge'),skillReport:r.skillReport});
   }
   item.candidates[name]={score:summary(scores),scores,traces};
  }
  result.cases.push(item);console.log(JSON.stringify({key:row.key,candidates:Object.fromEntries(Object.entries(item.candidates).map(([k,v]:any)=>[k,v.score]))}));
 }
 writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(output);
}finally{rmSync(scratch,{recursive:true,force:true});}
