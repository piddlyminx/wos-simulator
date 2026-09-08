import assert from 'node:assert/strict';
import { prepareBattle, runPrepared, signedRemainingScore } from '../../../../../simulator/src/simulator';
import { battleScoreDelta } from '../../../../../simulator/src/tooling/testcases';
import { installWorkerThreadBatchHandler } from '../../../../../scripts/workerThreadBatchWorker';

installWorkerThreadBatchHandler((jobs: any[]) => jobs.map(job => {
  const prepared = prepareBattle(job.input, job.config);
  const outcomes = [];
  for (let index = 0; index < job.previousSamples.length; index++) {
    const result = runPrepared(prepared, `${job.seed}#${index}`, { mode: index === 0 ? 'trace' : 'fast' });
    assert.equal(signedRemainingScore(result), job.previousSamples[index], `Changed original outcome at ${job.key} ${job.variant}#${index}`);
    const score = battleScoreDelta(result);
    assert(Number.isFinite(score));
    outcomes.push({ index, score, winner: result.winner, rounds: result.rounds, remaining: result.remaining,
      attacker: Object.values(result.remaining.attacker).reduce((sum, count) => sum + count, 0),
      defender: Object.values(result.remaining.defender).reduce((sum, count) => sum + count, 0),
      atRoundLimit: result.rounds >= (job.input.maxRounds ?? 1500), deterministic: result.randomness.deterministic });
  }
  return { samples: outcomes.map(row => row.score), outcomes,
    deterministic: outcomes[0].deterministic,
    changedScoreCount: outcomes.filter((row, index) => row.score !== job.previousSamples[index]).length,
    roundLimitCount: outcomes.filter(row => row.atRoundLimit).length,
    winnerCounts: Object.fromEntries(['attacker', 'defender', 'draw'].map(winner => [winner, outcomes.filter(row => row.winner === winner).length])) };
}));
