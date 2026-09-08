import { prepareBattle, runPrepared } from '../../../../simulator/src/simulator';
import { battleScoreDelta } from '../../../../simulator/src/tooling/testcases';
import { installWorkerThreadBatchHandler } from '../../../../scripts/workerThreadBatchWorker';

installWorkerThreadBatchHandler((jobs: any[]) => jobs.map(job => {
  const prepared = prepareBattle(job.input, job.config);
  const outcomes = [];
  let firstSample;
  for (let index = 0; index < job.repeat; index++) {
    const result = runPrepared(prepared, `${job.seed}#${index}`, { mode: index === 0 ? 'trace' : 'fast' });
    outcomes.push({ score: battleScoreDelta(result), winner: result.winner, rounds: result.rounds, remaining: result.remaining });
    if (index === 0) firstSample = {
      skillReport: result.skillReport,
      extraJobs: result.attacks.filter(attack => attack.sourceEffectId === 'DosageBoost/1').length,
      normalJobsWithEffect: result.attacks.filter(attack => attack.kind === 'normal' && attack.appliedEffects?.some(effect => effect.effectId === 'DosageBoost/1')).length,
      deterministic: result.randomness.deterministic,
    };
  }
  return { samples: outcomes.map(outcome => outcome.score), outcomes, firstSample };
}));
