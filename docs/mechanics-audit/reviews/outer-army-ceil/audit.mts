import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSimulatorConfig } from '../../../../simulator/src/config-node';
import { prepareTestcaseCases, adaptTestcaseEntry, executeTestcaseCase } from '../../../../simulator/src/tooling/testcases';
import { compareOutcomeDistribution } from '../../../../simulator/src/tooling/parityMetrics';
import { BatchWorkerPool } from '../../../../simulator/src/workerPool';
import { WorkerThreadBatchWorker } from '../../../../scripts/workerThreadBatchWorker';

const dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(dir, '../../../..');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const config = loadSimulatorConfig();
const configText = JSON.stringify(config, null, 2) + '\n';
const configPath = resolve(dir, 'config.json');
if (existsSync(configPath)) assert.equal(readFileSync(configPath, 'utf8'), configText, 'Frozen config differs; create a separately named audit for another config');
else writeFileSync(configPath, configText);
const frozen = existsSync(resolve(dir, 'results.json')) ? JSON.parse(readFileSync(resolve(dir, 'results.json'), 'utf8')) : null;
const metadata = frozen?.runtimeMetadata ?? read('tmp/mechanics-audit-2026-09-07/nohero-mixed/variant-definitions.json');
for (const [path, expected] of Object.entries(metadata.original_source_sha256)) assert.equal(hash(readFileSync(resolve(root, path))), expected, `Runtime snapshot drifted: ${path}`);
const raw = read('docs/mechanics-audit/baseline/raw-samples.json');
const baseline = new Map(raw.cases.map((row: any) => [row.key, row]));
const options = { repeat: Number(process.argv[2] ?? 256), seed: raw.options.seed, workers: 8 };
const prepared = prepareTestcaseCases(options);
assert.equal(prepared.parseErrors.length, 0);
const archivedPath = 'docs/mechanics-audit/reviews/wu-ming-solo-superseded.json';
const archived = read(archivedPath)[0];
const activeCases = frozen ? prepared.cases.filter(c => frozen.results.some((row: any) => row.key === c.key)) : prepared.cases;
const cases: any[] = [...activeCases, { file: resolve(root, archivedPath), reportFile: archivedPath,
  key: `${archivedPath}#0`, index: 0, testcaseId: 'wu_ming_solo_superseded', entry: archived, input: adaptTestcaseEntry(archived, options) }];
if (frozen) {
  assert.equal(cases.length, frozen.results.length, 'Frozen fixture missing');
  for (const c of cases) assert.equal(hash(readFileSync(c.file)), frozen.results.find((row: any) => row.key === c.key).sourceSha256, `Frozen fixture changed: ${c.key}`);
}
const total = (fighter: any) => Object.values(fighter.troops).reduce((sum: number, count: any) => sum + count, 0);
const pool = new BatchWorkerPool(options.workers, () => new WorkerThreadBatchWorker(new URL('./worker.mts', import.meta.url)));
let completed = 0;
try {
  const results = await Promise.all(cases.map(async c => {
    assert(c.input && c.key);
    const job = { file: c.file, reportFile: c.reportFile, testcaseId: c.testcaseId, index: c.index,
      input: c.input, repeat: options.repeat, seed: options.seed, simulationMode: 'fast' };
    let original: any = baseline.get(c.key);
    if (!original) {
      const result = executeTestcaseCase(job, config);
      assert(!result.error, result.error);
      original = { deterministic: result.deterministic, samples: result.simulatorSamples, stats: result.simulatorStats };
    }
    const candidate: any = await pool.runTask(job);
    assert.equal(candidate.deterministic, original.deterministic, `Classification changed: ${c.key}`);
    const observations = c.entry.game_report_result;
    const game = (Array.isArray(observations) ? observations : [observations]).map(o => o.attacker - o.defender);
    const comparison = (samples: number[]) => compareOutcomeDistribution({ candidate: { samples }, reference: { samples: game },
      initialTroops: total(c.input.attacker) + total(c.input.defender),
      outcomeRange: { min: -total(c.input.defender), max: total(c.input.attacker) }, deterministic: candidate.deterministic });
    const before = comparison(original.samples), after = comparison(candidate.samples);
    const originalPaired = original.samples.slice(0, candidate.samples.length);
    const pairedDifferences = candidate.samples.map((score: number, i: number) => score - originalPaired[i]);
    const det = candidate.deterministic ? {
      oldScore: original.samples[0], newScore: candidate.samples[0],
      oldMaxError: Math.max(...game.map((score: number) => Math.abs(original.samples[0] - score))),
      newMaxError: Math.max(...game.map((score: number) => Math.abs(candidate.samples[0] - score))),
    } : null;
    const row = { key: c.key, acceptedEmulatorEvidence: c.reportFile.startsWith('testcases/emulator_verified/'),
      historicalArchived: c.reportFile === archivedPath, sourceSha256: hash(readFileSync(c.file)),
      input: c.input, game, deterministic: candidate.deterministic, baseline: { stats: original.stats, comparison: before },
      candidate: { ...candidate, comparison: after }, pairedDifferences, det };
    if (++completed % 25 === 0) console.log(`Completed ${completed}/${cases.length}`);
    return row;
  }));
  const det = results.filter(row => row.deterministic);
  const sto = results.filter(row => !row.deterministic);
  const groups = {
    deterministicNewFailures: det.filter(row => row.det.oldMaxError <= 2 && row.det.newMaxError > 2),
    deterministicResolved: det.filter(row => row.det.oldMaxError > 2 && row.det.newMaxError <= 2),
    deterministicWorse: det.filter(row => row.det.newMaxError > row.det.oldMaxError),
    deterministicBetter: det.filter(row => row.det.newMaxError < row.det.oldMaxError),
    stochasticNewScreenFailures: sto.filter(row => row.baseline.comparison.p >= 1 / 250 && row.candidate.comparison.p < 1 / 250),
    stochasticScreenFailures: sto.filter(row => row.candidate.comparison.p < 1 / 250),
  };
  writeFileSync(resolve(dir, 'results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), options,
    interpretation: 'Retrospective counterfactual. Exact captured inputs unchanged; only outer army-term ceil removed in isolated runtime. Same seed prefix as preserved baseline. No statistical model-selection claim; stochastic screens need confirmation when material.',
    configSha256: hash(configText), runtimeMetadata: metadata, baselineRawSha256: hash(readFileSync(resolve(root, 'docs/mechanics-audit/baseline/raw-samples.json'))),
    counts: { total: results.length, acceptedEmulator: results.filter(r => r.acceptedEmulatorEvidence).length, deterministic: det.length, stochastic: sto.length },
    groups: Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.map(row => row.key)])), results }, null, 2) + '\n');
  console.log(JSON.stringify(Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.map(row => ({ key: row.key, accepted: row.acceptedEmulatorEvidence,
    ...(row.det ?? { before: row.baseline.comparison.p, after: row.candidate.comparison.p }) }))])), null, 2));
} finally { await pool.close(); }
