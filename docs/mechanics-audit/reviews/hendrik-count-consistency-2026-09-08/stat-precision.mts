import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSimulatorConfig } from '../../../../simulator/src/config-node';
import { prepareBattle, runPrepared } from '../../../../simulator/src/simulator';

const dir = dirname(fileURLToPath(import.meta.url)), root = resolve(dir, '../../../..');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const sourcePaths = readdirSync(join(root, 'simulator/src')).filter(p => p.endsWith('.ts')).map(p => join(root, 'simulator/src', p));
const config = loadSimulatorConfig();
const hashes = Object.fromEntries(sourcePaths.map(p => [p, hash(p)]));
const fields = ['attacker', 'defender'].flatMap(side => ['inf', 'lanc', 'mark'].flatMap(unit => ['attack', 'defense', 'lethality', 'health'].map(stat => [side, unit, stat])));
const vectors = [fields.map(() => 0)];
for (const sign of [1, -1]) vectors.push(fields.map(([side]) => sign * .05 * (side === 'attacker' ? 1 : -1)));
for (let i = 0; i < fields.length; i++) for (const sign of [1, -1]) vectors.push(fields.map((_, j) => i === j ? sign * .05 : 0));
let state = 202609080;
const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
for (let n = 0; n < 512; n++) vectors.push(fields.map(() => random() * .1 - .05));
const cases = [];
for (const id of ['hendrik_dragons_heir_250m_vs_400i_100l_100m', 'hendrik_small_timing_250m_vs_150i_60l_60m']) {
  const path = join(root, 'simulator/testcases/emulator_verified', id + '.json');
  const fixtureHash = hash(path), fixture = read(path)[0];
  const input = read(join(root, 'docs/mechanics-audit/probes', id.includes('small') ? 'hendrik-small-timing' : 'hendrik-dragons-heir', 'captured-input.json'));
  for (const side of ['attacker', 'defender']) {
    assert.deepEqual(input[side].stats, fixture[side].stats);
    assert.deepEqual(input[side].troops, fixture[side].troops);
    assert.deepEqual(input[side].heroes, fixture[side].heroes);
  }
  const results = vectors.map((vector, index) => {
    const candidate = structuredClone(input);
    fields.forEach(([side, unit, stat], j) => candidate[side].stats[unit][stat] += vector[j]);
    const r = runPrepared(prepareBattle(candidate, config), 'hendrik-stat-precision', { mode: index === 0 ? 'trace' : 'fast' });
    assert.equal(r.randomness.deterministic, true);
    return { remaining: r.remaining, rounds: r.rounds, skillReport: r.skillReport.attacker, ...(index === 0 ? { trace: r.trace, attacks: r.attacks } : {}) };
  });
  assert.equal(hash(path), fixtureHash);
  const totals = results.map(r => Object.values(r.remaining.defender).reduce((a, b) => a + b, 0));
  const summary = { id, game: fixture.game_report_result, nominal: results[0].remaining.defender, favorable: results[1].remaining.defender, adverse: results[2].remaining.defender, totalRange: [Math.min(...totals), Math.max(...totals)], rounds: [...new Set(results.map(r => r.rounds))] };
  console.log(JSON.stringify(summary));
  cases.push({ summary, input, fixtureHash, results });
}
for (const [path, sha] of Object.entries(hashes)) assert.equal(hash(path), sha);
assert.deepEqual(loadSimulatorConfig(), config);
writeFileSync(join(dir, 'stat-precision.json'), JSON.stringify({ generatedAt: new Date().toISOString(), exposure: 'Retrospective. Existing game outcomes known. Current unmodified engine; no fitted coefficients. Two opposing corners, each single-coordinate endpoint and 512 shared interior samples are a sensitivity screen, not an exhaustive interval proof.', sourceHashes: hashes, config, fields, vectors, cases }, null, 2) + '\n', { flag: 'wx' });
