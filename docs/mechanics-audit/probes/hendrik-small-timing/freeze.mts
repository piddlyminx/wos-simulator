import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadSimulatorConfig} from '../../../../simulator/src/config-node';

const dir=dirname(fileURLToPath(import.meta.url));
const read=(path:string)=>JSON.parse(readFileSync(resolve(dir,path),'utf8'));
const hash=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
const write=(name:string,value:any)=>writeFileSync(resolve(dir,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
assert(!existsSync(resolve(dir,'manifest.json')),'Preserve the existing frozen package');
const prior=read('../gwen-small-timing-550/manifest.json');
for(const[name,expected]of Object.entries(prior.files))assert.equal(hash(readFileSync(resolve(dir,'../../../../simulator/src',name))),expected,`Current runtime differs from reusable archive: ${name}`);
assert.equal(hash(readFileSync(resolve(dir,'../gwen-small-timing-550/runtime.tar.gz'))),prior.archive_sha256);
copyFileSync(resolve(dir,'../gwen-small-timing-550/runtime.tar.gz'),resolve(dir,'runtime.tar.gz'));
const input=read('../hendrik-dragons-heir/captured-input.json');
input.defender.troops={infantry_t6:150,lancer_t6:60,marksman_t6:60};
write('input.json',input);
const current=loadSimulatorConfig();
const variants=Object.fromEntries(['current','s3_first_two','s2_first_one','s2_delay_one'].map(name=>[name,structuredClone(current)]));
variants.s3_first_two.heroDefinitions.Hendrik.skills.DragonsHeir.trigger.first=2;
variants.s2_first_one.heroDefinitions.Hendrik.skills.ArmorOfBarnacles.trigger.first=1;
(variants.s2_delay_one.heroDefinitions.Hendrik.skills.ArmorOfBarnacles.effects['ArmorOfBarnacles/1'].duration as any).turns.delay=1;
write('variants.json',variants);
write('spec.json',{
 test_id:'hendrik_small_timing_250m_vs_150i_60l_60m',
 description:'Prospective full Hendrik3/3/3 timing discriminator. WIP250T6Marksmen versus minxxx nohero150T6Infantry/60T6Lancers/60T6Marksmen. Earlier S3 round2 versus configured round3; competing S2 timing retained. Full frozen package docs/mechanics-audit/probes/hendrik-small-timing. Fresh report stats required before interpretation.',
 emulator:{attacker:{instance:'WIP'},defender:{instance:'minxxx'}},
 attacker:{heroes:input.attacker.heroes,troops:input.attacker.troops},
 defender:{heroes:input.defender.heroes,troops:input.defender.troops},
});
write('protocol.json',{
 frozen_at:new Date().toISOString(),
 exposure:'The earlier17-Lancer and471-Marksman defender outcomes were known. This250-vs270 battle has not been run or observed. Its formation was selected in the preserved twelve-formation retrospective screen.',
 reason:'Distinguish S3 phase with larger relative separation and all defender lines surviving; no default control or live kit change.',
 primary:'Configured S3 first3/every3 predicts78 defenders; first2/every3 predicts71. Check source precision before live action.',
 alternatives:'S2 first1/every4 and S2 delayed1 remain separate causal alternatives; no magnitudes, troop keys, source ceilings or fractional state changed.',
 stats:'Conditional on exact preceding Hendrik3/3/3 report stats. No generation stats added. Freeze all models and replay fresh report inputs if they differ.',
 materiality:'Sub1000 armies: aim around1–2 survivors, judge line vectors and endpoint gaps in context. Precision screen is not an exhaustive bound.',
 });
const artifacts=Object.fromEntries(['input.json','variants.json','spec.json','protocol.json','predict.mts','freeze.mts'].map(name=>[name,hash(readFileSync(resolve(dir,name)))]));
write('manifest.json',{files:prior.files,artifacts,archive_sha256:prior.archive_sha256,description:'Current runtime verified identical to reused archive. Fractional state and inner source count ceil retained; outer army-term ceil removed.'});
console.log(JSON.stringify({frozen:dir,artifacts},null,2));
