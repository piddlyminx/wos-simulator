#!/usr/bin/env tsx
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {isDeepStrictEqual} from 'node:util';
import type {SimulatorConfig} from '../simulator/src/types';
import {loadSimulatorConfig} from '../simulator/src/config-node';
import {BatchWorkerPool} from '../simulator/src/workerPool';
import {WorkerThreadBatchWorker} from './workerThreadBatchWorker';
import {createHeroOptimizationWorkerContext,countOptimizationCandidates,generateOptimizationCandidateKeys,effectiveDefinitionForOptimizationCandidate} from './three_army_optimizer';
import {createSearchModel,definitionForLoadout,exportConfiguration,gearCandidates,coarseCompositions,localCompositions,passOrder,gearNames,assertOutputDiffers,prepareArtifactDirectory,type Loadout,type SearchModel} from './three_army_loadout_optimizer';
import {swiss,roundRobin,uniqueLoadouts,loadoutKey,score,type PlayPair,type PairResult,type Standing} from './three_army_swiss';
import type {PairTask} from './three_army_swiss_optimizer.worker';

export interface Options {path:string;output?:string;benchmarks:string[];jobs:number;passes:number;rounds:number;screenReps:number;qualifierReps:number;finalReps:number;seed:number;coarseStep:number;refineStep:number;seeds:number;maxCandidates:number}
export function parseArgs(argv:string[]):Options{
  const o:Options={path:'',benchmarks:[],jobs:20,passes:2,rounds:14,screenReps:2,qualifierReps:16,finalReps:1000,seed:314159,coarseStep:10,refineStep:2,seeds:3,maxCandidates:100000};
  const flags:Record<string,keyof Options>={'--jobs':'jobs','--passes':'passes','--rounds':'rounds','--screen-reps':'screenReps','--qualifier-reps':'qualifierReps','--final-reps':'finalReps','--seed':'seed','--coarse-step':'coarseStep','--refine-step':'refineStep','--seeds':'seeds','--max-candidates':'maxCandidates'};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--output'||arg==='--benchmark'){
      const value=argv[++i];if(!value||value.startsWith('--'))throw new Error(`${arg} needs a path`);
      if(arg==='--output')o.output=value;else o.benchmarks.push(value);continue;
    }
    if(flags[arg]){const n=Number(argv[++i]);if(!Number.isSafeInteger(n)||n<(arg==='--seed'?0:1))throw new Error(`Invalid ${arg}`);(o as unknown as Record<string,unknown>)[flags[arg]]=n;continue;}
    if(arg.startsWith('--')||o.path)throw new Error(`Unexpected argument ${arg}`);o.path=arg;
  }
  if(!o.path)throw new Error('Provide a three-army configuration');
  for(const n of [o.screenReps,o.qualifierReps,o.finalReps])if(n%2)throw new Error('Match budgets must be even: half in each battle role');
  if(o.coarseStep>100||o.refineStep>o.coarseStep)throw new Error('Invalid troop grid steps');
  return o;
}
function readJson(path:string):any{
  try{return JSON.parse(readFileSync(path,'utf8'))}catch(e){throw new Error(`${path}: ${e instanceof Error?e.message:String(e)}`)}
}
function benchmarkHeroes(heroes:Loadout['heroes'][number],config:SimulatorConfig){
  const entries=Array.isArray(heroes)?heroes.map(h=>[h.name,h.levels??{}] as const):Object.entries(heroes??{});
  return entries.map(([name,levels])=>{
    const normalized=name.toLowerCase().replace(/[^a-z0-9]/g,'');
    const key=config.heroDefinitions[name]?name:config.heroAliasIndex?.[normalized]??Object.keys(config.heroDefinitions).find(k=>k.toLowerCase().replace(/[^a-z0-9]/g,'')===normalized||config.heroDefinitions[k].name.toLowerCase().replace(/[^a-z0-9]/g,'')===normalized);
    if(!key||!config.heroDefinitions[key])throw new Error(`Unknown benchmark hero ${name}`);
    const definition=config.heroDefinitions[key];
    const skills=Object.keys(definition.skills).map((id,i)=>Number(levels[`skill_${i+1}`]??levels[id]??0));
    if(skills.some(n=>!Number.isInteger(n)||n<0||n>5))throw new Error(`Invalid benchmark skill levels for ${name}`);
    return {name:key,type:definition.troop_type,skills};
  }).sort((a,b)=>a.name.localeCompare(b.name));
}

export function compatibleBenchmark(model:SearchModel,candidate:SearchModel,config:SimulatorConfig,path:string):Loadout{
  if(candidate.side!==model.side)throw new Error(`${path}: different optimized side`);
  for(const t of ['infantry','lancer','marksman'] as const){
    for(const k of ['attack','defense','lethality','health'] as const){
      if(Math.abs(candidate.gear.base_stats[t][k]-model.gear.base_stats[t][k])>.011)throw new Error(`${path}: different account base stats`);
    }
  }
  const allNames:string[]=[];
  candidate.initial.heroes.forEach((h,i)=>{
    const entries=benchmarkHeroes(h,config),optimization=model.definition.optimization;
    allNames.push(...entries.map(h=>h.name));
    if(!optimization){
      if(!isDeepStrictEqual(entries,benchmarkHeroes(model.initial.heroes[i],config)))throw new Error(`${path}: different fixed heroes or skill levels in march ${i+1}`);
    }else{
      if(entries.length!==3||new Set(entries.map(h=>h.type)).size!==3)throw new Error(`${path}: march ${i+1} needs one hero of each troop type`);
      const pool=optimization.per_army_hero_pools?.[i]??optimization.hero_pools!;
      for(const hero of entries){
        const type=hero.type;
        if(type!=='infantry'&&type!=='lancer'&&type!=='marksman')throw new Error(`${path}: ${hero.name} has no troop type`);
        const available=benchmarkHeroes(Object.fromEntries(pool[type].map(name=>[name,{}])),config);
        if(!available.some(h=>h.name===hero.name))throw new Error(`${path}: ${hero.name} is not available in march ${i+1}`);
        if(hero.skills.some((level,j)=>level!==(optimization.hero_skill_levels[j]??0)))throw new Error(`${path}: incompatible skill levels for ${hero.name} in march ${i+1}`);
      }
    }
    if(!isDeepStrictEqual(candidate.definition[candidate.side][i].fighter.passive,model.definition[model.side][i].fighter.passive))throw new Error(`${path}: different march passives in march ${i+1}`);
  });
  if(model.definition.optimization?.unique_heroes&&new Set(allNames).size!==allNames.length)throw new Error(`${path}: duplicated heroes`);
  if(!isDeepStrictEqual(candidate.troopIds,model.troopIds))throw new Error(`${path}: different troop tiers`);
  const gear={...candidate.initial.gear};
  for(const t of ['infantry','lancer','marksman'] as const){
    const unused=new Set([0,1,2]);
    gear[t]=candidate.initial.gear[t].map(i=>{
      const match=model.gear.sets[t].findIndex((s,index)=>unused.has(index)&&Object.keys(s.stats).every(k=>Math.abs(s.stats[k as keyof typeof s.stats]-candidate.gear.sets[t][i].stats[k as keyof typeof s.stats])<.011));
      if(match<0)throw new Error(`${path}: incompatible ${t} gear`);unused.delete(match);return match;
    }) as [number,number,number];
  }
  if(candidate.initial.troops.some((c,i)=>c.reduce((a,b)=>a+b,0)!==model.initial.troops[i].reduce((a,b)=>a+b,0)))throw new Error(`${path}: different march capacities`);
  return {...candidate.initial,gear};
}

export async function main(argv=process.argv.slice(2)):Promise<void>{
  if(argv.includes('--help')){console.log(`Usage: tsx scripts/three_army_swiss_optimizer.ts CONFIG [options]
--benchmark PATH       Add an earlier compatible setup to every stage and the final field
--output PATH          Winner and artifact directory (must be fresh)
--jobs 20 --passes 2 --rounds 14 --screen-reps 2 --qualifier-reps 16 --final-reps 1000
--coarse-step 10 --refine-step 2 --seeds 3 --seed 314159 --max-candidates 100000
Each pair budget is total matches, half attacking and half defending.
Screen rounds use 1×/2×/4× the screening budget. No eliminations before round six.
See scripts/three_army_swiss_optimizer.md.`);return;}
  const o=parseArgs(argv),started=performance.now(),config=loadSimulatorConfig();
  const destination=resolve(o.output??`test_results/runs/swiss_search_${new Date().toISOString().replace(/[:.]/g,'-')}/winner.json`);
  assertOutputDiffers(o.path,destination);
  for(const path of o.benchmarks)assertOutputDiffers(path,destination);
  const root=prepareArtifactDirectory(destination,/^(?:input|methodology|history|final_qualifier|final|summary|stage_\d+)\.json$|^(?:pairs|candidates)\.jsonl$/);
  const save=(name:string,value:unknown)=>writeFileSync(resolve(root,name),JSON.stringify(value,null,2)+'\n');
  const raw=readJson(o.path);raw.ordering='sequential';save('input.json',raw);
  const model=createSearchModel(raw,config);
  const context=model.definition.optimization?createHeroOptimizationWorkerContext(model.definition,config):undefined;
  const heroCount=context?countOptimizationCandidates(context,o.maxCandidates):1;
  const benchmarks:Loadout[]=o.benchmarks.map(path=>compatibleBenchmark(model,createSearchModel(readJson(path),config),config,path));
  save('methodology.json',{options:o,heroCount,ordering:'sequential',approach:'Broad Swiss fields of candidate teams; staged increases in repetitions; conditional hero/gear/troop refinement; final round robin',benchmarks:o.benchmarks});
  const log=(message:string)=>process.stderr.write(`${((performance.now()-started)/1000).toFixed(1)}s ${message}\n`);
  const pool=new BatchWorkerPool<PairTask,PairResult>(o.jobs,()=>new WorkerThreadBatchWorker(new URL('./three_army_swiss_optimizer.worker.ts',import.meta.url)));
  const registry=new Map<string,{id:number;loadout:Loadout}>();let matches=0,sequence=0,stage='';
  const id=(s:Loadout)=>{const key=loadoutKey(s);let entry=registry.get(key);if(!entry){entry={id:registry.size,loadout:s};registry.set(key,entry);appendFileSync(resolve(root,'candidates.jsonl'),JSON.stringify(entry)+'\n')}return entry.id};
  const play:PlayPair=async(a,b,reps,seed)=>{
    const result=await pool.runTask({left:definitionForLoadout(model,a)[model.side],right:definitionForLoadout(model,b)[model.side],reps,seed,maxRounds:model.definition.max_rounds});
    matches+=result.matches;appendFileSync(resolve(root,'pairs.jsonl'),JSON.stringify({stage,left:id(a),right:id(b),seed,...result})+'\n');return result;
  };
  const archive:Loadout[]=[model.initial,...benchmarks];const history:unknown[]=[];
  async function race(states:Loadout[],label:string):Promise<Standing[]>{
    stage=label;const seed=o.seed+10000019*++sequence;
    const field=uniqueLoadouts([...states,...benchmarks]);
    if(field.length>o.maxCandidates+benchmarks.length+1)throw new Error(`${label}: too many candidates`);
    field.forEach(id);log(`${label}: ${field.length} complete candidate teams`);
    const screened=await swiss(field,{rounds:o.rounds,reps:o.screenReps,jobs:o.jobs,seed,freezeAfter:6,keep:64},play,m=>log(`${label}: ${m}`));
    const qualifiers=uniqueLoadouts([...screened.filter(s=>!s.frozen).slice(0,64).map(s=>s.loadout),states[0],...benchmarks]);
    const confirmed=await swiss(qualifiers,{rounds:8,reps:o.qualifierReps,jobs:o.jobs,seed:seed+5000003,freezeAfter:9,keep:64},play,m=>log(`${label}, confirmation: ${m}`));
    const finalists=uniqueLoadouts([...confirmed.slice(0,8).map(s=>s.loadout),states[0],...benchmarks]);
    const final=await roundRobin(finalists,64,o.jobs,seed+9000001,play,m=>log(`${label}, finalist checks: ${m}`));
    archive.push(...confirmed.slice(0,8).map(s=>s.loadout),...final.standings.map(s=>s.loadout));
    save(`stage_${sequence}.json`,{label,screened,confirmed,final});
    history.push({label,field:field.length,winner:final.standings[0].loadout,score:score(final.standings[0])});
    return final.standings;
  }
  function* heroes(current:Loadout):Generator<Loadout>{
    if(!model.definition.optimization){yield current;return;}
    const c=createHeroOptimizationWorkerContext(definitionForLoadout(model,current),config);
    for(const key of generateOptimizationCandidateKeys(c))yield {...current,heroes:effectiveDefinitionForOptimizationCandidate(c,key)[model.side].map(a=>a.fighter.heroes) as Loadout['heroes']};
  }
  let current=model.initial;
  try{
    log(`Legal heroes: ${heroCount}; Swiss pairs always balance battle roles; no fixed opponent panel`);
    for(let pass=0;pass<o.passes;pass++)for(const category of passOrder(pass)){
      const label=`Pass ${pass+1}/${o.passes}, ${category}`;
      if(category!=='troops'){
        const candidates=category==='heroes'?[...heroes(current)]:[...gearCandidates(current)];
        current=(await race([current,...candidates],label))[0].loadout;continue;
      }
      for(let army=0;army<3;army++){
        const withCounts=(counts:Loadout['troops'][number]):Loadout=>{const troops=[...current.troops] as Loadout['troops'];troops[army]=counts;return {...current,troops}};
        const total=current.troops[army].reduce((a,b)=>a+b,0);
        const coarse=await race([current,...coarseCompositions(total,o.coarseStep).map(withCounts)],`${label}, march ${army+1}, coarse`);
        current=coarse[0].loadout;
        const fine=await race([current,...coarse.slice(0,o.seeds).flatMap(s=>localCompositions(s.loadout.troops[army],o.coarseStep,o.refineStep).map(withCounts))],`${label}, march ${army+1}, fine`);
        current=fine[0].loadout;
        const local=await race([current,...fine.slice(0,o.seeds).flatMap(s=>localCompositions(s.loadout.troops[army],o.refineStep,1).map(withCounts))],`${label}, march ${army+1}, 1%`);
        current=local[0].loadout;
      }
    }
    stage='Final field';const finalField=uniqueLoadouts(archive);log(`Final field: ${finalField.length} complete setups`);
    const qualified=await swiss(finalField,{rounds:14,reps:o.qualifierReps,jobs:o.jobs,seed:o.seed+70000001,freezeAfter:9,keep:32},play,log);
    const finalists=uniqueLoadouts([...qualified.filter(s=>!s.frozen).slice(0,12).map(s=>s.loadout),model.initial,...benchmarks]);
    stage='Independent final round robin';
    const final=await roundRobin(finalists,o.finalReps,o.jobs,o.seed+90000001,play,log);
    const winner=final.standings[0].loadout;save('final_qualifier.json',qualified);save('final.json',final);save('history.json',history);
    writeFileSync(destination,JSON.stringify(exportConfiguration(raw,model,winner,config),null,2)+'\n');
    save('summary.json',{elapsedSeconds:(performance.now()-started)/1000,matches,distinctCandidates:registry.size,finalField:finalField.length,finalists:finalists.length,winner,gear:gearNames(model,winner),standings:final.standings});
    log(`Complete: ${matches} matches, ${registry.size} distinct candidates`);
    console.log(JSON.stringify({elapsedSeconds:(performance.now()-started)/1000,matches,winner,gear:gearNames(model,winner),standings:final.standings.map(s=>({id:s.id,score:score(s),wins:s.wins,draws:s.draws,games:s.games,loadout:s.loadout}))},null,2));
  }finally{await pool.close()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e);process.exitCode=1});
