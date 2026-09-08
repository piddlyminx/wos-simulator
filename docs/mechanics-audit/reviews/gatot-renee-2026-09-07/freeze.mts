import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {loadSimulatorConfig} from '../../../../simulator/src/config-node';
import {adaptTestcaseEntry} from '../../../../simulator/src/tooling/testcases';
const dir=dirname(fileURLToPath(import.meta.url)),root=resolve(dir,'../../../..');
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const inv=JSON.parse(readFileSync(resolve(root,'docs/mechanics-audit/inventory.json'),'utf8'));
const keys=['hero:Gatot:GoldenGuard','hero:Gatot:KingsBestowal','hero:Gatot:RoyalLegion','hero:Renee:NightmareTrace','hero:Renee:Dreamcatcher','hero:Renee:Dreamslice'];
const selections=keys.map(key=>{const row=inv.definitions.find((d:any)=>d.key===key);assert(row&&row.review_status==='unreviewed');return {key,hero:row.owner,id:row.id,slot:row.slot,activeCoverage:row.coverage,fixtureKeys:[...row.coverage.fixture_keys],definition:row.definition};});
const cases:any={};
for(const key of new Set(selections.flatMap(s=>s.fixtureKeys))){const fixture=inv.fixtures.find((row:any)=>row.key===key);assert.equal(fixture.provenance.game_evidence_status,'accepted_game_evidence');
 const text=readFileSync(resolve(root,fixture.path),'utf8');assert.equal(hash(text),fixture.source_sha256);const rows=JSON.parse(text),entry=Array.isArray(rows)?rows[fixture.index]:rows;
 assert(!entry.disabled&&!entry.stale);
 cases[key]={key,path:fixture.path,fixtureSha256:hash(text),entry,input:adaptTestcaseEntry(entry),game:entry.game_report_result,hydratedSkills:fixture.hydrated_skills,provenance:'Active accepted corpus'};
}
const archives=JSON.parse(readFileSync(resolve(dir,'archive-manifest.json'),'utf8'));
for(const archive of archives){const text=readFileSync(resolve(dir,archive.storedPath),'utf8');assert.equal(hash(text),archive.sha256);const rows=JSON.parse(text);
 for(const [index,entry]of(Array.isArray(rows)?rows:[rows]).entries()){
  assert(!entry.disabled&&!entry.stale);const key=`archive:${archive.originalPath}#${index}`;
  cases[key]={key,path:archive.originalPath,fixtureSha256:archive.sha256,entry,input:adaptTestcaseEntry(entry),game:entry.game_report_result,provenance:archive};
  for(const s of selections.filter(s=>s.hero==='Renee'))s.fixtureKeys.push(key);
 }
}
const gwenPath='skill/tmp/renee_gwen_2k_discriminator.ts',gwenScript=readFileSync(resolve(root,gwenPath),'utf8');
const inputLiteral=gwenScript.split('const input: BattleInput = ')[1]?.split('\n};')[0];assert(inputLiteral&&gwenScript.includes('observed: 1221'));
const gwenInput=JSON.parse(JSON.stringify(runInNewContext(`(${inputLiteral}\n})`))),gwenKey=`archive:${gwenPath}#observed`;
cases[gwenKey]={key:gwenKey,path:gwenPath,fixtureSha256:hash(gwenScript),input:gwenInput,game:[{attacker:1221,defender:0}],provenance:'Recorded observed1221 and complete literal input in prior diagnostic; model outputs and its draw-scoring helper are not imported as evidence.'};
for(const s of selections.filter(s=>s.hero==='Renee'))s.fixtureKeys.push(gwenKey);
function sources(path:string):string[]{return readdirSync(resolve(root,path),{withFileTypes:true}).flatMap(e=>e.isDirectory()?sources(`${path}/${e.name}`):e.name.endsWith('.ts')&&!e.name.endsWith('.test.ts')?[`${path}/${e.name}`]:[]);}
const config=loadSimulatorConfig();assert.equal(config.heroDefinitions.Hendrik.skills.DragonsHeir.trigger.first,2);
writeFileSync(resolve(dir,'config.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx'});
writeFileSync(resolve(dir,'cases.json'),JSON.stringify(cases,null,2)+'\n',{flag:'wx'});
const sourceHashes=Object.fromEntries([...sources('simulator/src'),'simulator/config/hero_definitions/Gatot.json','simulator/config/hero_definitions/Renee.json',gwenPath].map(path=>[path,hash(readFileSync(resolve(root,path)))]));
writeFileSync(resolve(dir,'protocol.json'),JSON.stringify({writtenAt:new Date().toISOString(),phase:'Retrospective accepted active and archived corpus review. Existing game observations and prior causal notes were read before fixed alternatives. No live action, coefficient fitting, stat changes or production edits.',selections,sourceHashes,
 artifacts:Object.fromEntries(['config.json','cases.json','freeze.mts','worker.mts','archive-manifest.json','check-provenance.mts','provenance-check.json',...archives.map((a:any)=>a.storedPath)].map(path=>[path,hash(readFileSync(resolve(dir,path)))])),
 variants:{GoldenGuard:['current','omit','all_own'],KingsBestowal:['current','omit','normal_only'],RoyalLegion:['current','omit','enemy_infantry_only'],NightmareTrace:['current','omit','skill_kind','immediate_delivery','carrier_all_sources'],Dreamcatcher:['current','omit','both_kinds','all_sources'],Dreamslice:['current','omit','both_kinds','lancer_only']},
 definitions:{current:'Complete current config. Established sequential conserved shield pool, fractional casualty state and ceil(source survivors) attack/shield strength are preserved.',omit:'Remove selected skill effects only; all actual heroes, levels and remaining kit stay configured.',all_own:'GoldenGuard recipients broadened from own Infantry to self.any.',normal_only:'KingsBestowal protects only normal damage; conserved sequential pool and all magnitudes unchanged.',enemy_infantry_only:'RoyalLegion affects enemy Infantry only.',skill_kind:'NightmareTrace generated job damage_kind skill instead of normal; carrier/target/magnitude unchanged.',immediate_delivery:'NightmareTrace child turns.delay=0 instead of1; no other lifecycle or arithmetic edit.',carrier_all_sources:'NightmareTrace mark can be consumed by any own class instead of only Lancers; one-use carrier and child target/source binding retained.',both_kinds:'Selected Dreamcatcher/Dreamslice child applies to both normal and skill damage.',all_sources:'Dreamcatcher child applies_vs any instead of parent.use.source.',lancer_only:'Dreamslice child applies_vs parent.use.source instead of any.'},
 sampling:{gatotRepeat:500,reneeRepeat:1000,seed:'gatot-renee-review-2026-09-07:<fixture-key>:<run-index>',traceRuns:16,score:'A-D including draws; retain exact both-side totals, per-class vectors, winner and rounds in each sample.',deterministic:'Run once and preserve all individual observation residuals; no universal >2 materiality rule or stochastic p-value.'},
 limits:['Active and archived records are accepted game evidence unless explicitly invalid/obsolete; distinct records alone do not establish independent battles. Frozen old forecasts and simulator outputs are not game evidence.','Archived no-hero controls are existing observations included unchanged for completeness; no new controls were captured.','Ambusher trial2 has explicitly contradictory total versus per-class source data: preserve primary A581/D9 (score572), metadata and conflict; do not silently repair.','Gatot game round-cap winners in fixtures are normalized to draw; prior evidence says UI awarded defender. Retain that semantic distinction and score A-D.','Historical incomplete-input observations in Gatot ledger remain documented but cannot be silently reconstructed.','Component omissions and scope contrasts provide conditional support, not unique identification of all probabilities, magnitudes, buckets, lifecycle or joiner branches.','Shared seeds do not ensure paired proc sequences after an omission alters RNG consumption.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({uniqueFixtures:Object.keys(cases).length,gameObservations:Object.values(cases).reduce((sum:number,c:any)=>sum+(Array.isArray(c.game)?c.game.length:1),0)}));
