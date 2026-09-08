import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareOutcomeDistribution } from '../../../../simulator/src/tooling/parityMetrics';
import { BatchWorkerPool } from '../../../../simulator/src/workerPool';
import { WorkerThreadBatchWorker } from '../../../../scripts/workerThreadBatchWorker';
const dir = dirname(fileURLToPath(import.meta.url)), root = resolve(dir, '../../../..');
const read = (name: string) => JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
const digest = (file: string) => createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
const definitions = read('definitions.json'), original = read('results.json');
const fixture = original.results.find((row: any) => row.key === 'testcases/3-testcases_mixed-heroes-not-verified.json#2');
const verify = () => { for (const [file, hash] of Object.entries(definitions.sourceHashes)) assert.equal(digest(file), hash); assert.equal(digest(fixture.key.split('#')[0]), fixture.fixtureSha256); };
verify();
const config = read('config-snapshot.json');
assert.equal(digest(resolve(dir, 'config-snapshot.json')), definitions.configSha256);
const protocol = { frozenAt: new Date().toISOString(), phase: 'retrospective_precision_refinement_after_primary_results', key: fixture.key, variant: 'current', repeat: 10000,
  seed: `${definitions.options.seed}:${fixture.key}`, reason: 'Primary p=.00475 lies close to the raw .004 diagnostic threshold. Refine only the same current model and exact input; no new semantic candidate or fit.',
  sourceHashes: definitions.sourceHashes, fixtureSha256: fixture.fixtureSha256, configSha256: definitions.configSha256,
  primaryResultsSha256: digest(resolve(dir, 'results.json')), overlap: 'The first1000 fixed-seed simulations repeat the primary sample; these are not independent additional predictions.' };
writeFileSync(resolve(dir, 'refinement-definitions.json'), JSON.stringify(protocol, null, 2)+'\n', {flag:'wx'});
const total = (fighter: any) => Object.values(fighter.troops).reduce((sum: number, count: any) => sum+count, 0);
const pool = new BatchWorkerPool(1, () => new WorkerThreadBatchWorker(new URL('./worker.mts', import.meta.url)));
try {
 const prediction: any = await pool.runTask({input: fixture.input, config, repeat: protocol.repeat, seed: protocol.seed, effectIds: [], skillIds: []});
 assert.deepEqual(prediction.outcomes.slice(0,1000), fixture.predictions.current.outcomes);
 const comparison = compareOutcomeDistribution({candidate:{samples:prediction.samples}, reference:{samples:fixture.game}, initialTroops:total(fixture.input.attacker)+total(fixture.input.defender), outcomeRange:{min:-total(fixture.input.defender),max:total(fixture.input.attacker)}, deterministic:prediction.deterministic});
 verify();
 writeFileSync(resolve(dir, 'refinement-results.json'), JSON.stringify({generatedAt:new Date().toISOString(), protocolSha256:digest(resolve(dir,'refinement-definitions.json')), key:fixture.key, game:fixture.game, ...prediction, comparison},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(comparison));
} finally {await pool.close();}
