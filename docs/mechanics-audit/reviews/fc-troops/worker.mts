import { prepareBattle, runPrepared, signedRemainingScore } from '../../../../simulator/src/simulator';
import { installWorkerThreadBatchHandler } from '../../../../scripts/workerThreadBatchWorker';

installWorkerThreadBatchHandler((jobs:any[]) => jobs.map(job => {
  const prepared = prepareBattle(job.input,job.config);
  const first = runPrepared(prepared,`${job.seed}#0`,{mode:'trace'});
  const count = first.randomness.deterministic ? 1 : job.repeat;
  const samples = [signedRemainingScore(first)];
  const winnerCounts:Record<string,number>={attacker:0,defender:0,draw:0};
  let roundLimitCount=0;
  const record=(result:any)=>{winnerCounts[result.winner]++;if(result.rounds >= (job.input.maxRounds ?? 1500))roundLimitCount++;};
  record(first);
  for(let index=1;index<count;index++) {
    const result=runPrepared(prepared,`${job.seed}#${index}`,{mode:'fast'});
    samples.push(signedRemainingScore(result));record(result);
  }
  const applications = first.attacks.flatMap(attack => (attack.appliedEffects ?? [])
    .filter(effect => /^(CrystalShield|BodyOfLight|CrystalLance|IncandescentField|Volley)\//.test(effect.effectId))
    .map(effect => `${effect.effectId}:${attack.kind}:${attack.dealerSide}.${attack.dealerUnit}->${attack.takerSide}.${attack.takerUnit}`));
  return { deterministic:first.randomness.deterministic,samples,winnerCounts,roundLimitCount,firstSample:{score:samples[0],winner:first.winner,rounds:first.rounds,remaining:first.remaining,
    reviewedEffectApplications:Object.fromEntries([...new Set(applications)].map(key => [key,applications.filter(value => value===key).length])),
    troopSkillReport:[...first.skillReport.attacker,...first.skillReport.defender].filter(row => row.sourceKind==='troop_skill'),
    extraSkillJobs:Object.fromEntries(['CrystalLance/1','Volley/1'].map(effect => [effect,first.attacks.filter(job => job.sourceEffectId===effect).length])) } };
}));
