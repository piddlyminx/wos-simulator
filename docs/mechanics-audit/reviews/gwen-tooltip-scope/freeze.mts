import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadSimulatorConfig} from '../../../../simulator/src/config-node';
import {adaptTestcaseEntry} from '../../../../simulator/src/tooling/testcases';
const dir=dirname(fileURLToPath(import.meta.url)),root=resolve(dir,'../../../..');
const hash=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
const baseline=JSON.parse(readFileSync(resolve(root,'tmp/mechanics-audit-2026-09-07/after-reina/simulator_parity_2026-09-07T06-10-29.116Z.json'),'utf8'));
const previous=JSON.parse(readFileSync(resolve(dir,'../gwen-preparation-snapshot/protocol.json'),'utf8'));
const sourceHashes=previous.sourceHashes;
for(const[path,digest]of Object.entries(sourceHashes))assert.equal(hash(readFileSync(resolve(root,path))),digest);
const cases=Object.entries(baseline.testcases).filter(([,v]:any)=>['attacker','defender'].some(side=>['heroes','joinerHeroes'].some(field=>'Gwen' in v.armies[side][field]))).map(([key,row]:any)=>{
 const text=readFileSync(resolve(root,row.file),'utf8'),entry=JSON.parse(text)[row.idx],raw=row.gameStatAdjustment?.unadjusted??row.game;
 return {key,fixtureSha256:hash(text),input:adaptTestcaseEntry(entry),game:entry.game_report_result,deterministic:row.deterministic,productionMean:raw.mu_candidate};
});
assert.equal(cases.length,7);
const config=loadSimulatorConfig();
writeFileSync(resolve(dir,'config.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx'});
writeFileSync(resolve(dir,'cases.json'),JSON.stringify(cases,null,2)+'\n',{flag:'wx'});
const tooltipHashes=Object.fromEntries([1,2,3].map(n=>{const path=`docs/mechanics-audit/hero-tooltips/minxxx-gwen-2026-09-07/skill_${n}-panel.png`;return[path,hash(readFileSync(resolve(root,path)))];}));
writeFileSync(resolve(dir,'protocol.json'),JSON.stringify({writtenAt:new Date().toISOString(),phase:'Retrospective: all seven recorded Gwen fixture outcomes and all three current in-game tooltips known before candidate selection or execution.',
 causalMotivation:'Current damage calculation advances an attack delay once per eligible job. A Gwen S1 activation skipped on normal can therefore apply to S2 and be consumed before S3 siblings. Test whether the source normal attack defines one shared Gwen modifier snapshot and use, rather than each component advancing/consuming it separately.',
 predictions:'Permanent S1 should generally increase damage and has already worsened earlier Gwen endpoints; reproduce its disconfirmation against the full accepted set. Normal-snapshot sharing should suppress newly primed S1 on same-cluster extras while preserving previously eligible S1 across siblings, so overall direction is not assumed. Normal-kind augmentation separately includes only existing normal-kind factors, no magnitude changes.',
 schedules:{production:{first:5,every:4},reset_after_delivery:{first:5,every:5}},
 models:{per_job:'Current per-job modifier eligibility and charge use.',persistent_s1:'Only S1 becomes battle-start and has no duration; all other job behavior current.',normal_snapshot:'Only Gwen S1/S2 modifiers selected on the successful normal job are copied to its generated damage components, respecting each original resolved target scope. They are charged once on normal; extras do not advance or consume those live Gwen modifiers. Other effects and all damage kinds remain current. Canceled normal attacks retain current handling.',normal_augmentation:'Same Gwen modifier snapshot as normal_snapshot; Gwen S2/S3 jobs additionally use normal damage kind. Magnitudes, source/target selectors and current treatment of other hero jobs remain unchanged.'},
 boundaries:['No production edits, coefficient fitting, stat adjustment or source-count changes.','Inner source ceiling and fractional survivor storage remain untouched.','The snapshot is narrowly Gwen S1/S2 effect eligibility, not a frozen whole damage result or a global redefinition of every hero extra attack.','One thousand shared-seed samples for the single Norah stochastic fixture; all six deterministic fixtures replayed exactly.','Battle endpoints and observed counts are known. Matching counts or totals does not alone select a unique model.'],
 sourceHashes,tooltipHashes,artifacts:Object.fromEntries(['config.json','cases.json','freeze.mts','replay.mts','patches.json'].map(path=>[path,hash(readFileSync(resolve(dir,path)))]))},null,2)+'\n',{flag:'wx'});
