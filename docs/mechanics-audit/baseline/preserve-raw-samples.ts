import { writeFileSync } from 'node:fs';
import { prepareTestcaseCases, type TestcaseExecutionJob, type TestcaseExecutionResult } from '../../../simulator/src/tooling/testcases';
import { BatchWorkerPool } from '../../../simulator/src/workerPool';
import { WorkerThreadBatchWorker } from '../../../scripts/workerThreadBatchWorker';

async function main() {
  const options = { repeat: 1000, seed: 'mechanics-audit-2026-09-07-baseline', workers: 12 };
  const prepared = prepareTestcaseCases(options);
  if (prepared.parseErrors.length) throw new Error(JSON.stringify(prepared.parseErrors));
  const pool = new BatchWorkerPool(options.workers, () => new WorkerThreadBatchWorker<TestcaseExecutionJob, TestcaseExecutionResult>(new URL('../../../scripts/testcase_worker.ts', import.meta.url)));
  try {
    const cases = await Promise.all(prepared.cases.map(async (c) => {
      if (!c.input || !c.key) throw new Error(`Unadapted case ${c.file}#${c.index}`);
      const job = { file: c.file, reportFile: c.reportFile, testcaseId: c.testcaseId, index: c.index, input: c.input, repeat: options.repeat, seed: options.seed };
      const execution = await pool.runTask(job);
      if (execution.error) throw new Error(`${c.key}: ${execution.error}`);
      return { key: c.key, file: c.reportFile, index: c.index, testcaseId: c.testcaseId, deterministic: execution.deterministic, stats: execution.simulatorStats, samples: execution.simulatorSamples };
    }));
    writeFileSync(new URL('./raw-samples.json', import.meta.url), JSON.stringify({ createdAt: new Date().toISOString(), options, cases }, null, 2) + '\n');
    console.log(`Preserved ${cases.length} cases; ${cases.reduce((n, c) => n + (c.samples?.length ?? 0), 0)} raw samples.`);
  } finally { await pool.close(); }
}
void main();
