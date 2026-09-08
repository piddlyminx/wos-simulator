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
const keys=['hero:Mia:BadLuckStreak','hero:Mia:LuckyCharm','hero:Mia:RitualDeciphering','hero:Molly:CallingOfTheStorm','hero:Molly:IceDominion'];
const selections=keys.map(key=>{const row=inv.definitions.find((d:any)=>d.key===key);assert(row && row.review_status==='unreviewed');return {key,hero:row.owner,id:row.id,slot:row.slot,coverage:row.coverage,definition:row.definition};});
const cases=Object.fromEntries([...new Set(selections.flatMap(s=>s.coverage.fixture_keys))].map((key:any)=>{
 const fixture=inv.fixtures.find((row:any)=>row.key===key);assert.equal(fixture.provenance.game_evidence_status,'accepted_game_evidence');
 const text=readFileSync(resolve(root,fixture.path),'utf8');assert.equal(hash(text),fixture.source_sha256);const rows=JSON.parse(text),entry=Array.isArray(rows)?rows[fixture.index]:rows;
 return [key,{key,path:fixture.path,fixtureSha256:hash(text),input:adaptTestcaseEntry(entry),game:entry.game_report_result,hydratedSkills:fixture.hydrated_skills}];
}));
function sources(path:string):string[]{return readdirSync(resolve(root,path),{withFileTypes:true}).flatMap(e=>e.isDirectory()?sources(`${path}/${e.name}`):e.name.endsWith('.ts')&&!e.name.endsWith('.test.ts')?[`${path}/${e.name}`]:[]);}
writeFileSync(resolve(dir,'config.json'),JSON.stringify(loadSimulatorConfig(),null,2)+'\n',{flag:'wx'});
writeFileSync(resolve(dir,'cases.json'),JSON.stringify(cases,null,2)+'\n',{flag:'wx'});
const sourceHashes=Object.fromEntries([...sources('simulator/src'),'simulator/config/hero_definitions/Mia.json','simulator/config/hero_definitions/Molly.json'].map(path=>[path,hash(readFileSync(resolve(root,path)))]));
writeFileSync(resolve(dir,'protocol.json'),JSON.stringify({writtenAt:new Date().toISOString(),phase:'Retrospective accepted-corpus review; baseline outcomes and current discrepancies were read before candidate selection. No live actions or coefficient fit.',
 selections,sourceHashes,artifacts:Object.fromEntries(['config.json','cases.json','freeze.mts','worker.mts'].map(path=>[path,hash(readFileSync(resolve(dir,path)))])),
 variants:{current:'Unmodified complete current config.',omit:'Remove only selected skill effects; keep all actual hero levels and other effects.',lancer_only:'For attack-triggered skills, restrict trigger.source to Lancer while preserving actual target selection. For turn-triggered protection skills, restrict recipients to own Lancers. Chance, magnitude, cadence, duration and other kit are unchanged.'},
 sampling:{repeat:1000,seed:'mia-molly-review-2026-09-07:<fixture-key>:<run-index>',traceRuns:16,score:'A-D including draws',deterministicAlternative:'Run once and report its exact endpoint, per-observation errors and zero empirical spread; distribution comparison is still computed against a point distribution, not hidden behind a deterministic percentage tolerance.'},
 limits:['Contribution/scope contrasts cannot independently certify proc probability, damage kind, delay, stacking bucket, all levels, exhaustion or rally/joiner behavior.','Shared string seeds do not guarantee paired skill proc events after an omission changes RNG consumption.','Existing full-kit disagreements remain explicit and cannot uniquely identify the selected skill as the cause.','Molly YouthfulRage remains configured throughout; it is outside this five-skill annotation batch.']},null,2)+'\n',{flag:'wx'});
