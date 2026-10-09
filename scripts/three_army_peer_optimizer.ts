import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {loadSimulatorConfig} from '../simulator/src/config-node';
import {BatchWorkerPool} from '../simulator/src/workerPool';
import {WorkerThreadBatchWorker} from './workerThreadBatchWorker';
import {countOptimizationCandidates,createHeroOptimizationWorkerContext,generateOptimizationCandidateKeys,effectiveDefinitionForOptimizationCandidate} from './three_army_optimizer';
import {createSearchModel,definitionForLoadout,searchLoadouts,exportConfiguration,gearNames,parseCli,assertOutputDiffers,prepareArtifactDirectory} from './three_army_loadout_optimizer';
import {buildOpponentPanel} from './three_army_peer_panel';
import type {Loadout} from './three_army_loadout_optimizer';
import {roundRobin,score} from './three_army_swiss';
if(process.argv.includes('--help')){
 console.log(`Usage: tsx scripts/three_army_peer_optimizer.ts CONFIG [loadout search options]
--output PATH selects the winner file and artifact directory.
Defaults: 20 workers, 2 passes, 12 screening matches, 240 confirmation matches,
1200 panel-validation matches. All budgets must be divisible by 12.
Six opponents are generated from the current input; both battle roles are balanced.
Shortlist tournament: 200 matches per pair; final top twelve: 2000 per pair.
Uses shuffled starting slots and fixed sequential battle order.
See scripts/three_army_peer_optimizer.md for methodology and limitations.`);process.exit(0);
}
const cli=parseCli(['--screen-reps','12','--reps','240','--validation-reps','1200','--seeds','3','--finalists','16','--jobs','20','--seed','314159',...process.argv.slice(2)]);
const destination=resolve(cli.output??`test_results/runs/peer_search_${new Date().toISOString().replace(/[:.]/g,'-')}/winner.json`);
assertOutputDiffers(cli.path,destination);
prepareArtifactDirectory(destination,/^(?:input|panel|panel_loadouts|methodology|retained_candidates|search|shortlist|shortlist_loadouts|final|summary)\.json$|^evaluations\.jsonl$/);
const root=pathToFileURL(dirname(destination)+'/'),started=performance.now();
const save=(name:string,x:any)=>writeFileSync(new URL(name,root),JSON.stringify(x,null,2)+'\n');
const config=loadSimulatorConfig();
let raw:any;
try{raw=JSON.parse(readFileSync(cli.path,'utf8'));}catch(error){throw new Error(`${cli.path}: ${error instanceof Error?error.message:String(error)}`);}
raw.ordering='sequential';save('input.json',raw);
const model=createSearchModel(raw,config);
const key=(s:Loadout)=>JSON.stringify(s);
const heroKey=(s:Loadout)=>s.heroes.map(h=>Array.isArray(h)?h.map(x=>x.name):Object.keys(h??{})).flat().join('/');
const context=model.definition.optimization?createHeroOptimizationWorkerContext(model.definition,config):undefined;
if(context)countOptimizationCandidates(context,cli.options.maxCandidates);
const heroes=context?Array.from(generateOptimizationCandidateKeys(context),k=>effectiveDefinitionForOptimizationCandidate(context,k)[model.side].map(a=>a.fighter.heroes) as Loadout['heroes']):[model.initial.heroes];
const panel=buildOpponentPanel(model,heroes);
const armies=(s:Loadout)=>definitionForLoadout(model,s)[model.side];
save('panel.json',panel.map(armies));save('panel_loadouts.json',panel);
const options=cli.options;
for(const reps of [options.screenReps,options.reps,options.validationReps])if(reps%(2*panel.length))throw new Error(`Repetitions must be divisible by ${2*panel.length} for equal opponent and role weights`);
save('methodology.json',{ordering:'sequential',legalHeroCombinations:heroes.length,panelSize:panel.length,panelConstruction:'Six automatically selected legal hero lineups by maximum minimum hero distance, with varied ratios, role positions and gear; fixed throughout search',options,shortlistMatchesPerPair:200,finalMatchesPerPair:2000,sourceCaveat:model.inferredGear?'Gear profiles inferred from current input stats; later gear corrections are not applied automatically':'Using explicit gear profiles from current input',ranking:'Equal weight per opponent; wins plus half draws; signed survivor margin only for ties'});
const pool=new BatchWorkerPool<any,any>(options.jobs,()=>new WorkerThreadBatchWorker(new URL('./three_army_peer_optimizer.worker.ts',import.meta.url),{workerData:{panelPath:fileURLToPath(new URL('panel.json',root)),maxRounds:model.definition.max_rounds}}));
const archive=new Map<string,{loadout:Loadout,result:any,reps:number}>();let totalMatches=0;
const log=(s:string)=>process.stderr.write(`${((performance.now()-started)/1000).toFixed(1)}s ${s}\n`);
async function evaluate(s:Loadout,reps:number,seed:number){
 const result=await pool.runTask({armies:armies(s),reps,seed});
 assert.equal(result.evaluation.scenarios,reps);assert.equal(result.evaluation.attackerWins+result.evaluation.defenderWins+result.evaluation.draws,reps);
 totalMatches+=reps;
 const previous=archive.get(key(s));if(!previous||reps>=previous.reps)archive.set(key(s),{loadout:s,result,reps});
 appendFileSync(new URL('evaluations.jsonl',root),JSON.stringify({loadout:s,result,reps,seed})+'\n');
 return result;
}
async function tournament(states:Loadout[],reps:number,label:string){
 const resultPairs=await roundRobin(states,reps,options.jobs,1234567+(label==='final'?10000000:0),async(left,right,budget,seed)=>{
  const r=await pool.runTask({armies:armies(left),opponent:armies(right),reps:budget,seed});
  const e=r.evaluation;assert.equal(e.scenarios,budget);assert.equal(e.attackerWins+e.defenderWins+e.draws,budget);
  totalMatches+=budget;
  return {matches:budget,leftWins:e.attackerWins,rightWins:e.defenderWins,draws:e.draws,margin:r.averageMargin};
 },message=>log(`${label}: ${message}`));
 const rows=resultPairs.standings;
 assert.ok(rows.every(r=>r.games===reps*(rows.length-1)&&r.wins+r.losses+r.draws===r.games));
 assert.equal(rows.reduce((s,r)=>s+r.wins,0),rows.reduce((s,r)=>s+r.losses,0));
 assert.ok(Math.abs(rows.reduce((s,r)=>s+r.marginTotal,0))<.01);
 const standings=rows.map(r=>({id:r.id+1,loadout:r.loadout,games:r.games,wins:r.wins,losses:r.losses,draws:r.draws,points:r.wins+r.draws/2,margin:r.marginTotal,scoreRate:score(r),winRate:r.games?r.wins/r.games:0,averageMargin:r.games?r.marginTotal/r.games:0,heroes:heroKey(r.loadout),gear:gearNames(model,r.loadout)}));
 const pairs=resultPairs.pairs.map(({left,right,result:r})=>({left:left+1,right:right+1,leftWins:r.leftWins,rightWins:r.rightWins,draws:r.draws,leftScore:(r.leftWins+r.draws/2)/r.matches,averageLeftMargin:r.margin}));
 const result={label,matchesPerPair:reps,totalMatches:pairs.length*reps,standings,pairs};save(label+'.json',result);return result;
}
async function main(){try{
 log(`Search ${heroes.length} legal hero combinations per hero stage; ${panel.length} automatic fixed opponents, balanced roles; exact budgets ${options.screenReps}/${options.reps}/${options.validationReps}`);
 const search=await searchLoadouts(model,config,options,evaluate,log);save('search.json',search);
 const candidates:Loadout[]=[];const seen=new Set<string>();
 const add=(s:Loadout)=>{if(!seen.has(key(s))){seen.add(key(s));candidates.push(s)}};
 search.finalists.forEach(x=>add(x.loadout));add(model.initial);
 const ranked=[...archive.values()].filter(x=>x.reps>=options.reps).sort((a,b)=>b.result.scoreRate-a.result.scoreRate||b.result.averageMargin-a.result.averageMargin);
 const diversity=new Map<string,number>();let retained=0;
 for(const x of ranked){const h=heroKey(x.loadout);if((diversity.get(h)??0)>=3)continue;diversity.set(h,(diversity.get(h)??0)+1);add(x.loadout);if(++retained===24)break;}
 const screened=[...archive.values()].sort((a,b)=>b.result.scoreRate-a.result.scoreRate);
 const present=new Set(candidates.map(heroKey));let extra=0;
 for(const x of screened){const h=heroKey(x.loadout);if(present.has(h))continue;present.add(h);add(x.loadout);if(++extra===8)break;}
 save('shortlist_loadouts.json',candidates);save('retained_candidates.json',[...archive.values()]);
 const shortlist=await tournament(candidates,200,'shortlist');
 const final=await tournament(shortlist.standings.slice(0,12).map(x=>x.loadout),2000,'final');
 writeFileSync(destination,JSON.stringify(exportConfiguration(raw,model,final.standings[0].loadout,config),null,2)+'\n');
 save('summary.json',{elapsedSeconds:(performance.now()-started)/1000,totalMatches,searchEvaluations:search.evaluations,distinctEvaluated:archive.size,shortlistSize:candidates.length,finalists:final.standings.length,standings:final.standings});
 log(`Complete: ${totalMatches} matches; winner ${final.standings[0].heroes}`);
 console.log(JSON.stringify({elapsedSeconds:(performance.now()-started)/1000,totalMatches,standings:final.standings.map(({loadout,...r})=>({...r,troops:loadout.troops}))},null,2));
}finally{await pool.close();}}
main().catch(e=>{console.error(e);process.exitCode=1;});
