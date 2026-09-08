import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSimulatorConfig } from '../../../../simulator/src/config-node';
import { prepareBattle, runPrepared } from '../../../../simulator/src/simulator';

const dir = dirname(fileURLToPath(import.meta.url)), root = resolve(dir, '../../../..');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const path = resolve(root, 'simulator/config/hero_definitions/Hendrik.json'), sourceHash = hash(path);
const protocol = read(join(dir, 'protocol.json')), results = read(join(dir, 'results.json')).results;
const config = loadSimulatorConfig();
assert.equal(config.heroDefinitions.Hendrik.skills.DragonsHeir.trigger.first, undefined);
const actual = protocol.cases.map((c: any) => {
  const r = runPrepared(prepareBattle(c.input, config), 'hendrik-count-consistency', { mode: 'trace' });
  const previous = results.find((entry: any) => entry.id === c.id && entry.variant === 'first3');
  assert.deepEqual(r.remaining, previous.remaining);
  assert.equal(r.rounds, previous.rounds);
  assert.deepEqual(JSON.parse(JSON.stringify(r.skillReport[c.heroSide as 'attacker' | 'defender'])), previous.skillReport);
  assert.equal(r.randomness.deterministic, true);
  return { id: c.id, remaining: r.remaining, rounds: r.rounds, skillReport: r.skillReport[c.heroSide as 'attacker' | 'defender'] };
});
assert.equal(hash(path), sourceHash);
writeFileSync(join(dir, 'current-replay.json'), JSON.stringify({ generatedAt: new Date().toISOString(), sourceHash, note: 'Current file already lacked first2 when inspected. This review did not edit production. Three relevant current results match the frozen ordinary-first3 engine.', actual }, null, 2) + '\n', { flag: 'wx' });
console.log('All three current Hendrik cases match the frozen first3 results and skill reports.');
