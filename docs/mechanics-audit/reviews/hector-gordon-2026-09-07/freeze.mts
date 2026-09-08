import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadSimulatorConfig} from '../../../../simulator/src/config-node';
import {adaptTestcaseEntry} from '../../../../simulator/src/tooling/testcases';
const dir=dirname(fileURLToPath(import.meta.url)),root=resolve(dir,'../../../..');
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const inv=JSON.parse(readFileSync(resolve(root,'docs/mechanics-audit/inventory.json'),'utf8'));
const keys=['hero:Hector:SurvivalInstincts','hero:Hector:Rampant','hero:Hector:Blitz','hero:Gordon:VenomInfusion','hero:Gordon:ChemicalTerror'];
const selections=keys.map(key=>{const row=inv.definitions.find((d:any)=>d.key===key);assert(row&&row.review_status==='unreviewed');return {key,hero:row.owner,id:row.id,slot:row.slot,coverage:row.coverage,definition:row.definition};});
const cases=Object.fromEntries([...new Set(selections.flatMap(s=>s.coverage.fixture_keys))].map((key:any)=>{
 const fixture=inv.fixtures.find((row:any)=>row.key===key);assert.equal(fixture.provenance.game_evidence_status,'accepted_game_evidence');
 const text=readFileSync(resolve(root,fixture.path),'utf8'),rows=JSON.parse(text),entry=Array.isArray(rows)?rows[fixture.index]:rows;
 const inventoryHashMatched=hash(text)===fixture.source_sha256;
 if(!inventoryHashMatched)assert(fixture.path.startsWith('testcases/gatot_verified/'),'Unexpected fixture drift');
 assert(!entry.disabled&&!entry.stale);
 return [key,{key,path:fixture.path,fixtureSha256:hash(text),inventoryHashMatched,entry,input:adaptTestcaseEntry(entry),game:entry.game_report_result,hydratedSkills:fixture.hydrated_skills}];
}));
function sources(path:string):string[]{return readdirSync(resolve(root,path),{withFileTypes:true}).flatMap(e=>e.isDirectory()?sources(`${path}/${e.name}`):e.name.endsWith('.ts')&&!e.name.endsWith('.test.ts')?[`${path}/${e.name}`]:[]);}
const config=loadSimulatorConfig();assert.equal(config.heroDefinitions.Hendrik.skills.DragonsHeir.trigger.first,2);
writeFileSync(resolve(dir,'config.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx'});
writeFileSync(resolve(dir,'cases.json'),JSON.stringify(cases,null,2)+'\n',{flag:'wx'});
const sourceHashes=Object.fromEntries([...sources('simulator/src'),'simulator/config/hero_definitions/Hector.json','simulator/config/hero_definitions/Gordon.json','simulator/config/hero_definitions/Hendrik.json'].map(path=>[path,hash(readFileSync(resolve(root,path)))]));
writeFileSync(resolve(dir,'protocol.json'),JSON.stringify({writtenAt:new Date().toISOString(),phase:'Retrospective accepted-corpus structural review. Existing outcomes and discrepancies were inspected before candidate selection. No live actions, input adjustment or coefficient fit.',
 selections,sourceHashes,artifacts:Object.fromEntries(['config.json','cases.json','freeze.mts','worker.mts'].map(path=>[path,hash(readFileSync(resolve(dir,path)))])),
 variants:{SurvivalInstincts:['current','omit','infantry_only'],Rampant:['current','omit','omit_infantry','omit_marksman','no_decay'],Blitz:['current','omit','infantry_only'],VenomInfusion:['current','omit','omit_boost','omit_poison','hero_bucket'],ChemicalTerror:['current','omit','omit_offense','omit_debuff','enemy_infantry_only']},
 definitions:{current:'Complete current config with fractional army term, original inner source ceiling, corrected Reina magnitude and Hendrik S3 first=2.',omit:'Remove only selected skill effects; preserve all actual hero levels and other kit.',infantry_only:'SurvivalInstincts recipients restricted to own Infantry; Blitz trigger sources restricted to Infantry.',omit_infantry:'Remove Rampant/1 only.',omit_marksman:'Remove Rampant/2 only.',no_decay:'Remove Rampant value_evolution only; retain initial magnitudes and 10 attack uses.',omit_boost:'Remove VenomInfusion/1 only.',omit_poison:'Remove VenomInfusion/2 only.',hero_bucket:'Change VenomInfusion/1 from type.normal.damage.up to active.hero.damage.up, keeping its normal-kind restriction and all other fields.',omit_offense:'Remove ChemicalTerror/1 only.',omit_debuff:'Remove ChemicalTerror/2 only.',enemy_infantry_only:'Restrict ChemicalTerror/2 to enemy.infantry, preserving applies_vs self.any.'},
 sampling:{repeat:1000,seed:'hector-gordon-review-2026-09-07:<fixture-key>:<run-index>',traceRuns:16,score:'A-D including draws',deterministic:'Run once; preserve exact per-side vector, rounds and individual observation errors. No stochastic p-value or universal >2 materiality rule.'},
 limits:['Full-kit contributions cannot uniquely certify proc probability, damage kind, every timing/stacking branch, all levels or joiners.','Shared string seeds do not guarantee paired random skill activations when a counterfactual changes RNG consumption.','Existing mixed-hero, Hector/Renee/Wayne, Gordon/Wayne and Gatot disagreements remain explicit and are not attributed to these selected skills.','Gordon S3 and every companion skill remain configured, outside this batch.','Fresh Gatot fixture bytes include authorized exporter maxRounds/winner/round metadata; any stale inventory source digest is recorded explicitly, not used to discard accepted evidence.']},null,2)+'\n',{flag:'wx'});
