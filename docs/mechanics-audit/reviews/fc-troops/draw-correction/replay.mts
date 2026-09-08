import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BatchWorkerPool } from '../../../../../simulator/src/workerPool';
import { WorkerThreadBatchWorker } from '../../../../../scripts/workerThreadBatchWorker';
import { compareOutcomeDistribution } from '../../../../../simulator/src/tooling/parityMetrics';

const dir = dirname(fileURLToPath(import.meta.url)), root = resolve(dir, '../../../../..');
const path = 'docs/mechanics-audit/reviews/fc-troops/';
const read = (file: string) => JSON.parse(readFileSync(resolve(root, file), 'utf8'));
const digest = (file: string) => createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
const original = read(`${path}results.json`);
const config = read(`${path}config-snapshot.json`);
const preserved = ['worker.mts', 'replay.mts', 'results.json', 'confirmation.json', 'config-snapshot.json',
  'round-limit-verification.json', 'verify-round-limit.mts'];
const preservedHashes = Object.fromEntries(preserved.map(file => [`${path}${file}`, digest(`${path}${file}`)]));
for (const [file, hash] of Object.entries(original.sourceHashes)) assert.equal(digest(file), hash, `Frozen engine changed: ${file}`);
assert.equal(digest(`${path}config-snapshot.json`), original.configSha256);
const output = resolve(dir, 'results.json');
assert(!existsSync(output), 'Preserve correction results; do not overwrite.');
const total = (fighter: any): number => Object.values(fighter.troops).reduce((sum: number, count: any) => sum + count, 0);
const pool = new BatchWorkerPool(2, () => new WorkerThreadBatchWorker(new URL('./worker.mts', import.meta.url)));
try {
  const results = await Promise.all(original.results.filter((row: any) => row.key.includes('/s8-')).map(async (row: any) => {
    const file = row.key.split('#')[0];
    assert.equal(digest(file), row.fixtureSha256, `Fixture changed: ${file}`);
    const fixture = read(file)[0];
    const predictions = Object.fromEntries(await Promise.all(Object.entries(row.predictions).filter(([, prediction]: [string, any]) =>
      prediction.samples.includes(0)
    ).map(async ([variant, previous]: [string, any]) => {
      const candidate = structuredClone(config);
      if (variant === 'no_volley') delete candidate.troopSkills.skills.Volley;
      else if (variant === 'volley_extra_skill') candidate.troopSkills.skills.Volley.effects['Volley/1'] = {
        type: 'extra_skill_attack', value: [100], units: { applies_to: 'trigger.source', applies_vs: 'trigger.target' },
        trigger_damage_jobs: [{ source: 'use.source', target: 'use.target' }],
      };
      else assert.equal(variant, 'current');
      const corrected: any = await pool.runTask({ key: row.key, variant, input: row.input, config: candidate,
        previousSamples: previous.samples, seed: `${original.options.seed}:${fixture.test_id}` });
      const comparison = compareOutcomeDistribution({ candidate: { samples: corrected.samples }, reference: { samples: row.game },
        initialTroops: total(row.input.attacker) + total(row.input.defender),
        outcomeRange: { min: -total(row.input.defender), max: total(row.input.attacker) }, deterministic: corrected.deterministic });
      console.log(JSON.stringify({ key: row.key, variant, changedScores: corrected.changedScoreCount,
        mean: comparison.mu_candidate, sd: comparison.sigma_candidate, p: comparison.p, winners: corrected.winnerCounts }));
      return [variant, { ...corrected, comparison, previousComparison: previous.comparison }];
    })));
    return { key: row.key, fixtureSha256: row.fixtureSha256, input: row.input, gameOutcomes: row.gameOutcomes,
      game: row.game, predictions };
  }));
  for (const [file, hash] of Object.entries({ ...original.sourceHashes, ...preservedHashes })) assert.equal(digest(file), hash, `Source changed during correction: ${file}`);
  writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(),
    interpretation: 'Correction of a retrospective audit metric, not a combat-engine change. Replay only five draw-affected Volley candidates using the identical original seeds/config/runtime. Every old winner-score sample is reproduced before computing survivor margin A-D. Keep both sides, winner and rounds; original artifacts remain byte-for-byte unchanged.',
    scoring: 'battleScoreDelta = total surviving attackers minus total surviving defenders, including draws; same contract as production testcase runner and game outcome rows.',
    originalSeed: original.options.seed, originalSampleCount: original.options.repeat, sourceHashes: original.sourceHashes,
    configSha256: original.configSha256, preservedHashes, results }, null, 2) + '\n', { flag: 'wx' });
} finally { await pool.close(); }
