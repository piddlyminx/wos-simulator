import type {Loadout,SearchModel} from './three_army_loadout_optimizer';
import {permutations} from './three_army_loadout_optimizer';
import type {OptimizationResult} from './three_army_optimizer';

export function aggregate(results:OptimizationResult[],reverse:boolean[]):OptimizationResult {
 let n=0,w=0,l=0,d=0,own=0,other=0,battles=0,m2=0,mean=0;
 for(let i=0;i<results.length;i++){
  const e=results[i].evaluation,r=reverse[i],k=e.scenarios;
  const orientedMean=(r?-1:1)*e.averageAttackerMargin,delta=orientedMean-mean,total=n+k;
  m2+=Math.max(0,k-1)*e.attackerMarginStd**2+delta**2*n*k/total;
  mean+=delta*k/total;
  n=total;w+=r?e.defenderWins:e.attackerWins;l+=r?e.attackerWins:e.defenderWins;d+=e.draws;
  own+=k*(r?e.averageDefenderRemaining:e.averageAttackerRemaining);
  other+=k*(r?e.averageAttackerRemaining:e.averageDefenderRemaining);
  battles+=k*e.averageBattles;
 }
 const margin=(own-other)/n;
 return {rank:0,heroes:[],winRate:w/n,scoreRate:(w+d/2)/n,averageMargin:margin,evaluation:{scenarios:n,attackerWins:w,defenderWins:l,draws:d,attackerWinRate:w/n,defenderWinRate:l/n,averageAttackerRemaining:own/n,averageDefenderRemaining:other/n,averageAttackerMargin:margin,attackerMarginStd:n>1?Math.sqrt(Math.max(0,m2)/(n-1)):0,averageBattles:battles/n}};
}

function names(heroes:Loadout['heroes']):string[]{
 return heroes.flatMap(h=>Array.isArray(h)?h.map(x=>x.name):Object.keys(h??{}));
}
function distance(a:Loadout['heroes'],b:Loadout['heroes']):number{
 const x=names(a),y=names(b);return x.reduce((sum,name,i)=>sum+Number(name!==y[i]),0);
}
export function buildOpponentPanel(model:SearchModel,legalHeroes:Loadout['heroes'][]):Loadout[]{
 if(!legalHeroes.length)throw new Error('No legal hero combinations');
 const selected=[legalHeroes[0]];
 const remaining=new Set(legalHeroes.map((_,i)=>i));remaining.delete(0);
 while(selected.length<Math.min(6,legalHeroes.length)){
  let best=-1,maximum=-1;
  for(const i of remaining){const d=Math.min(...selected.map(h=>distance(h,legalHeroes[i])));if(d>maximum){maximum=d;best=i;}}
  selected.push(legalHeroes[best]);remaining.delete(best);
 }
 while(selected.length<6)selected.push(legalHeroes[selected.length%legalHeroes.length]);
 const quality=(t:'infantry'|'lancer'|'marksman')=>[0,1,2].sort((a,b)=>Object.values(model.gear.sets[t][b].stats).reduce((x,y)=>x+y,0)-Object.values(model.gear.sets[t][a].stats).reduce((x,y)=>x+y,0));
 const lancer=quality('lancer'),marksman=quality('marksman');
 return selected.map((heroes,i)=>{
  const heavy=i%3,inf=[45,55,65][Math.floor(i/3)%3];
  const troops=model.initial.troops.map((c,j)=>{
   const total=c.reduce((a,b)=>a+b,0),ratios=j===heavy?[inf,100-inf,0]:[inf,2,98-inf];
   const counts=ratios.map(r=>Math.floor(total*r/100)) as [number,number,number];counts[0]+=total-counts.reduce((a,b)=>a+b,0);
   if(j===heavy&&counts[0]>0){counts[0]--;counts[2]=1;}return counts;
  }) as Loadout['troops'];
  const others=[0,1,2].filter(j=>j!==heavy);
  const gear={infantry:permutations([0,1,2])[i%6],lancer:[0,0,0] as [number,number,number],marksman:[0,0,0] as [number,number,number]};
  gear.lancer[heavy]=lancer[0];gear.lancer[others[0]]=lancer[1];gear.lancer[others[1]]=lancer[2];
  gear.marksman[heavy]=marksman[2];gear.marksman[others[0]]=marksman[i%2];gear.marksman[others[1]]=marksman[1-i%2];
  return {heroes,gear,troops};
 });
}
