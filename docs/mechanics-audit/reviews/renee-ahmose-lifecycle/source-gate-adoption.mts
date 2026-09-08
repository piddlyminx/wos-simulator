import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSimulatorConfig } from '../../../../simulator/src/config-node';
import { prepareBattle, runPrepared } from '../../../../simulator/src/simulator';
import { adaptTestcaseEntry } from '../../../../simulator/src/tooling/testcases';

const dir = dirname(fileURLToPath(import.meta.url)), root = resolve(dir, '../../../..');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const protocol = read(join(dir, 'source-gate-protocol.json'));
const expected = read(join(dir, 'source-gate-results.json')).results;
const config = loadSimulatorConfig();
const frozenConfig = read(resolve(dir, '../../probes/ahmose-no-infantry/config.json'));
frozenConfig.heroDefinitions.Ahmose.skills.ViperFormation.trigger.source = 'infantry';
assert.deepEqual(config, frozenConfig, 'Only the Ahmose source requirement should change the frozen config');

const cases = [...protocol.active, ...protocol.archived, {
  key: 'prospective:source-death', input: protocol.prospectiveFollowup
}];
const summaries = [];
for (const testcase of cases) {
  const previous = expected.find((entry: any) => entry.key === testcase.key);
  assert(previous, testcase.key);
  const result = runPrepared(prepareBattle(testcase.input, config), `source-gate:${testcase.key}`, { mode: 'fast' });
  const actual = {
    winner: result.winner, rounds: result.rounds, remaining: result.remaining,
    skillReport: result.skillReport, effectActivationCounts: result.effectActivationCounts,
    randomness: result.randomness
  };
  assert.deepEqual(actual, previous.candidate, testcase.key);
  if (previous.ahmose) summaries.push({ key: testcase.key, game: previous.game, before: previous.baseline.remaining, after: result.remaining });
}

const newFixtures = ['ahmose_no_infantry_240l_vs_125i', 'ahmose_source_dies_001i_480l_vs_250i'].map(id => {
  const path = resolve(root, `testcases/emulator_verified/${id}.json`), [entry] = read(path);
  const result = runPrepared(prepareBattle(adaptTestcaseEntry(entry), config), 'adopted-source-gate', { mode: 'fast' });
  const observed = read(resolve(dir, `../../probes/ahmose-no-infantry/${id.includes('source_dies') ? 'source-death/' : ''}capture-01/observation.json`));
  if (observed.remaining_troops) assert.deepEqual(result.remaining, observed.remaining_troops);
  for (const side of ['attacker', 'defender'] as const) {
    assert.equal(Object.values(result.remaining[side]).reduce((sum, n) => sum + n, 0), observed.survivors[side]);
  }
  assert.equal(result.winner, observed.winner);
  assert.equal(result.randomness.deterministic, true);
  return { path: `testcases/emulator_verified/${id}.json`, sha256: hash(path), winner: result.winner, remaining: result.remaining };
});

// Re-evaluate the existing S2 omission contrast after the S1 correction; no game inputs change.
const prayerReview = [];
for (const key of ['testcases/emulator_verified/ahmose_solo_nc.json#0', 'testcases/emulator_verified/renee_ahmose_damage_taken_overlap_attacker_nc.json#0']) {
  const testcase = cases.find(entry => entry.key === key);
  const variants: Record<string, unknown> = {};
  for (const variant of ['current', 'omitPrayer', 'prayerAllOwn']) {
    const candidate = structuredClone(config), prayer = candidate.heroDefinitions.Ahmose.skills.PrayerOfFlame;
    if (variant === 'omitPrayer') prayer.effects = {};
    if (variant === 'prayerAllOwn') Object.values(prayer.effects).forEach(effect => { effect.units = { ...effect.units, applies_to: 'self.any' }; });
    const result = runPrepared(prepareBattle(testcase.input, candidate), 'prayer-after-source-correction', { mode: 'fast' });
    assert.equal(result.randomness.deterministic, true);
    variants[variant] = { winner: result.winner, rounds: result.rounds, remaining: result.remaining };
  }
  prayerReview.push({ key, game: testcase.game, variants });
}

const validation = {
  createdAt: new Date().toISOString(),
  scope: 'Production matches all303 frozen private-candidate results under one identical seed per input. This includes297 non-Ahmose inputs unchanged versus the old engine, not a fresh distribution test of those cases.',
  rowsMatched: cases.length,
  unrelatedUnchanged: expected.filter((entry: any) => !entry.ahmose).length,
  sourceHashes: Object.fromEntries(['simulator/src/runtimeSkills.ts', 'simulator/src/simulator.ts', 'simulator/src/config.ts', 'simulator/config/hero_definitions/Ahmose.json'].map(path => [path, hash(resolve(root, path))])),
  newFixtures, ahmoseComparisons: summaries, prayerReview,
  prayerReviewExposure: 'Retrospective: all existing outcomes and the new source-dependence evidence were known before this conditional re-review.'
};
const output = process.argv[2] ? resolve(process.argv[2]) : join(dir, 'source-gate-adoption.json');
writeFileSync(output, JSON.stringify(validation, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(validation, null, 2));
