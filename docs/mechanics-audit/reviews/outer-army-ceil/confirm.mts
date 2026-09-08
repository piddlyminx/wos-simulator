import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { BatchWorkerPool } from '../../../../simulator/src/workerPool';
import { WorkerThreadBatchWorker } from '../../../../scripts/workerThreadBatchWorker';
import { compareOutcomeDistribution } from '../../../../simulator/src/tooling/parityMetrics';
import { prepareTestcaseCases, executeTestcaseCase } from '../../../../simulator/src/tooling/testcases';

const screen = JSON.parse(readFileSync(new URL('./results.json', import.meta.url), 'utf8'));
const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
const options = { repeat: 10000, seed: screen.options.seed, workers: 8 };
const prepared = prepareTestcaseCases(options);
const selected = screen.results.filter((row: any) => !row.deterministic && (
  Math.min(row.baseline.comparison.p, row.candidate.comparison.p) < 0.03 ||
  row.candidate.comparison.p < 0.1 && row.candidate.comparison.p < row.baseline.comparison.p / 2));
writeFileSync(new URL('./confirmation-selection.json', import.meta.url), JSON.stringify({
  rule: 'Before confirmation: minimum baseline or256-screen p<0.03, or candidate p<0.1 and drops by at least2x. Includes existing tail disagreements and Alonso v2 deterioration.',
  options, keys: selected.map((row: any) => row.key) }, null, 2) + '\n');
const pool = new BatchWorkerPool(options.workers, () => new WorkerThreadBatchWorker(new URL('./worker.mts', import.meta.url)));
const total = (fighter: any) => Object.values(fighter.troops).reduce((sum: number, count: any) => sum + count, 0);
try {
  const results = await Promise.all(selected.map(async (row: any) => {
    const c = prepared.cases.find(c => c.key === row.key)!;
    assert(c);
    const job = { file: c.file, reportFile: c.reportFile, testcaseId: c.testcaseId, index: c.index, input: row.input,
      repeat: options.repeat, seed: options.seed, simulationMode: 'fast' };
    const candidate: any = await pool.runTask(job);
    const comparison = (samples: number[]) => compareOutcomeDistribution({ candidate: { samples }, reference: { samples: row.game },
      initialTroops: total(row.input.attacker) + total(row.input.defender),
      outcomeRange: { min: -total(row.input.defender), max: total(row.input.attacker) }, deterministic: false });
    const candidateComparison = comparison(candidate.samples);
    const matchedBaseline = executeTestcaseCase(job, config);
    assert(!matchedBaseline.error, matchedBaseline.error);
    console.log(`${row.key}: ${comparison(matchedBaseline.simulatorSamples!).p} -> ${candidateComparison.p}`);
    return { key: row.key, acceptedEmulatorEvidence: row.acceptedEmulatorEvidence, game: row.game,
      candidate: { ...candidate, comparison: candidateComparison },
      baseline: { samples: matchedBaseline.simulatorSamples, stats: matchedBaseline.simulatorStats,
        comparison: comparison(matchedBaseline.simulatorSamples!) } };
  }));
  writeFileSync(new URL('./confirmation.json', import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(), options, results }, null, 2) + '\n');
} finally { await pool.close(); }
