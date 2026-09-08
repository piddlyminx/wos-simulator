import { prepareBattle, runPrepared } from '../../../../simulator/src/simulator';
import { battleScoreDelta } from '../../../../simulator/src/tooling/testcases';
import { installWorkerThreadBatchHandler } from '../../../../scripts/workerThreadBatchWorker';

installWorkerThreadBatchHandler((jobs: any[]) => jobs.map(job => {
  const prepared = prepareBattle(job.input, job.config);
  const first = runPrepared(prepared, `${job.seed}#0`, { mode: 'trace' });
  const count = first.randomness.deterministic ? 1 : job.repeat;
  const outcomes = [];
  for (let index = 0; index < count; index++) {
    const result = index === 0 ? first : runPrepared(prepared, `${job.seed}#${index}`, { mode: 'fast' });
    outcomes.push({ score: battleScoreDelta(result), winner: result.winner, rounds: result.rounds, remaining: result.remaining });
  }
  const applications = first.attacks.flatMap(attack => (attack.appliedEffects ?? [])
    .filter(effect => job.effectIds.includes(effect.effectId))
    .map(effect => `${effect.effectId}:${attack.kind}:${attack.dealerSide}.${attack.dealerUnit}->${attack.takerSide}.${attack.takerUnit}`));
  return { deterministic: first.randomness.deterministic, samples: outcomes.map(row => row.score), outcomes,
    firstSample: { skillReport: Object.fromEntries(Object.entries(first.skillReport).map(([side, rows]) => [side,
      rows.filter(row => job.skillIds.includes(row.skillId))])),
      effectApplications: Object.fromEntries([...new Set(applications)].map(key => [key, applications.filter(value => value === key).length])),
      normalAttackRounds: Object.fromEntries(['attacker', 'defender'].map(side => [side, Object.fromEntries(['infantry', 'lancer', 'marksman'].map(unit => [unit,
        first.attacks.filter(attack => attack.kind === 'normal' && attack.dealerSide === side && attack.dealerUnit === unit).map(attack => attack.round)]))])) } };
}));
