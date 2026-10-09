import type {Loadout} from './three_army_loadout_optimizer';
import {seededShuffle} from './tournament/rng';

export interface PairResult { matches:number; leftWins:number; rightWins:number; draws:number; margin:number }
export type PlayPair=(left:Loadout,right:Loadout,reps:number,seed:number)=>Promise<PairResult>;
export interface Standing {
  id:number; loadout:Loadout; games:number; wins:number; losses:number; draws:number;
  marginTotal:number; opponents:number[]; byes:number; frozen:boolean;
}
export interface SwissOptions { rounds:number; reps:number; jobs:number; seed:number; freezeAfter:number; keep:number }
export function loadoutKey(s:Loadout):string {
  const heroes=s.heroes.map(h=>{
    const entries=Array.isArray(h)?h.map(x=>[x.name,x.levels] as const):Object.entries(h??{});
    return entries.sort((a,b)=>a[0].localeCompare(b[0])).map(([name,levels])=>[name,Object.entries(levels??{}).filter(([,n])=>n!==0).sort()]);
  });
  return JSON.stringify([heroes,['infantry','lancer','marksman'].map(t=>s.gear[t as keyof Loadout['gear']]),s.troops]);
}
export function uniqueLoadouts(states:Loadout[]):Loadout[]{return [...new Map(states.map(s=>[loadoutKey(s),s])).values()]}
export function score(s:Standing):number{return s.games?(s.wins+s.draws/2)/s.games:.5}
export function compare(a:Standing,b:Standing):number {
  return score(b)-score(a)||(b.games?b.marginTotal/b.games:0)-(a.games?a.marginTotal/a.games:0)||a.id-b.id;
}
export function standings(states:Loadout[]):Standing[]{
  return uniqueLoadouts(states).map((loadout,id)=>({id,loadout,games:0,wins:0,losses:0,draws:0,marginTotal:0,opponents:[],byes:0,frozen:false}));
}
export function applyPair(left:Standing,right:Standing,result:PairResult):void {
  if(result.matches!==result.leftWins+result.rightWins+result.draws)throw new Error('Invalid match accounting');
  for(const [a,b,w,l,sign] of [[left,right,result.leftWins,result.rightWins,1],[right,left,result.rightWins,result.leftWins,-1]] as const){
    a.games+=result.matches;a.wins+=w;a.losses+=l;a.draws+=result.draws;
    a.marginTotal+=sign*result.margin*result.matches;a.opponents.push(b.id);
  }
}
export function pairRound(active:Standing[],round:number,seed:number):{pairs:[Standing,Standing][];bye?:Standing}{
  let ordered=round<3?seededShuffle(active,seed+round):[...active].sort(compare);
  let bye:Standing|undefined;
  if(ordered.length%2){
    const minimum=Math.min(...ordered.map(s=>s.byes));
    bye=seededShuffle(ordered.filter(s=>s.byes===minimum),seed+round*1009)[0];
    ordered=ordered.filter(s=>s!==bye);bye.byes++;
  }
  const pairs:[Standing,Standing][]=[];
  while(ordered.length){
    const a=ordered.shift()!;
    let best=0,least=Infinity;
    for(let i=0;i<Math.min(16,ordered.length);i++){
      const repeats=a.opponents.filter(id=>id===ordered[i].id).length;
      if(repeats<least){least=repeats;best=i;}if(!repeats)break;
    }
    pairs.push([a,ordered.splice(best,1)[0]]);
  }
  // Repair late repeated pairings by swapping with a nearby pair.
  for(let i=0;i<pairs.length;i++){
    const [a,b]=pairs[i];if(!a.opponents.includes(b.id))continue;
    for(let j=Math.max(0,i-16);j<Math.min(pairs.length,i+17);j++){
      if(i===j)continue;const [c,d]=pairs[j];
      if(!a.opponents.includes(c.id)&&!b.opponents.includes(d.id)){pairs[i]=[a,c];pairs[j]=[b,d];break;}
      if(!a.opponents.includes(d.id)&&!b.opponents.includes(c.id)){pairs[i]=[a,d];pairs[j]=[b,c];break;}
    }
  }
  return {pairs,bye};
}
export async function concurrentMap<T,R>(items:T[],jobs:number,fn:(item:T,index:number)=>Promise<R>):Promise<R[]>{
  const out:R[]=new Array(items.length);let next=0;
  await Promise.all(Array.from({length:Math.min(jobs,items.length)},async()=>{while(next<items.length){const i=next++;out[i]=await fn(items[i],i)}}));
  return out;
}
export async function swiss(states:Loadout[],options:SwissOptions,play:PlayPair,progress:(message:string)=>void=()=>{}):Promise<Standing[]>{
  const rows=standings(states);let active=[...rows];
  for(let round=0;round<options.rounds&&active.length>1;round++){
    const {pairs}=pairRound(active,round,options.seed);
    const reps=options.reps*(round<4?1:round<8?2:4);
    progress(`round ${round+1}/${options.rounds}: ${active.length} candidates, ${pairs.length} pairs × ${reps} matches`);
    const results=await concurrentMap(pairs,options.jobs,([a,b],i)=>play(a.loadout,b.loadout,reps,options.seed+round*1000003+i*1009));
    results.forEach((r,i)=>applyPair(pairs[i][0],pairs[i][1],r));
    if(round+1>=options.freezeAfter&&active.length>options.keep){
      active.sort(compare);
      const retain=Math.max(options.keep,Math.ceil(active.length*.75));
      active.splice(retain).forEach(s=>s.frozen=true);
    }
  }
  return [...active.sort(compare),...rows.filter(s=>s.frozen).sort(compare)];
}
export async function roundRobin(states:Loadout[],reps:number,jobs:number,seed:number,play:PlayPair,progress:(message:string)=>void=()=>{}):Promise<{standings:Standing[];pairs:{left:number;right:number;result:PairResult}[]}>{
  const rows=standings(states),tasks:[Standing,Standing][]=[];
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++)tasks.push([rows[i],rows[j]]);
  progress(`${rows.length} candidates, ${tasks.length} pairs × ${reps} matches`);
  const results=await concurrentMap(tasks,jobs,([a,b],i)=>play(a.loadout,b.loadout,reps,seed+i*1009));
  results.forEach((r,i)=>applyPair(tasks[i][0],tasks[i][1],r));
  return {standings:rows.sort(compare),pairs:tasks.map(([a,b],i)=>({left:a.id,right:b.id,result:results[i]}))};
}
