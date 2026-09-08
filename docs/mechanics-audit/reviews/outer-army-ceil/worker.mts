import { readFileSync } from 'node:fs';
import { executeTestcaseCase } from '../../../../tmp/mechanics-audit-2026-09-07/nohero-mixed/runtimes/fractional_army_term/tooling/testcases';
import { installWorkerThreadBatchHandler } from '../../../../scripts/workerThreadBatchWorker';

const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
installWorkerThreadBatchHandler((jobs: any[]) => jobs.map(job => {
  const result = executeTestcaseCase(job, config);
  if (result.error) throw Error(`${job.file}#${job.index}: ${result.error}`);
  return { deterministic: result.deterministic, samples: result.simulatorSamples,
    stats: result.simulatorStats, rounds: result.result?.rounds };
}));
