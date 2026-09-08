import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSimulatorConfig } from '../../../../../simulator/src/config-node';
import { prepareBattle, runPrepared } from '../../../../../simulator/src/simulator';
import { adaptTestcaseEntry, battleScoreDelta } from '../../../../../simulator/src/tooling/testcases';

const dir = dirname(fileURLToPath(import.meta.url)), root = resolve(dir, '../../../../..');
const read = (file: string) => JSON.parse(readFileSync(resolve(root, file), 'utf8'));
const digest = (file: string) => createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
const frozen = read(resolve(dir, 'definitions.json'));
const predicted = read(resolve(dir, 'results.json'));
const original = read(resolve(dir, 'config-snapshot.json'));
const expected = structuredClone(original);
expected.heroDefinitions.Hendrik.skills.DragonsHeir.trigger.first = 2;
const current = loadSimulatorConfig();
assert.deepEqual(current, expected, 'Production config must differ only by Hendrik S3 first=2.');
assert.deepEqual(current.heroDefinitions.Hendrik.skills.ArmorOfBarnacles, original.heroDefinitions.Hendrik.skills.ArmorOfBarnacles);
const hendrikSource = 'simulator/config/hero_definitions/Hendrik.json';
const currentSourceHashes = Object.fromEntries(Object.keys(frozen.sourceHashes).map(file => [file, digest(file)]));
const changedSources = Object.keys(currentSourceHashes).filter(file => currentSourceHashes[file] !== frozen.sourceHashes[file]);
assert.deepEqual(changedSources, [hendrikSource]);
const preservedFiles = ['definitions.json', 'results.json', 'config-snapshot.json', 'exposure-before-replay.json', 'summary.json'];
const preservedHashes = Object.fromEntries(preservedFiles.map(file => [file, digest(resolve(dir, file))]));
const results = frozen.fixtures.map((fixture: any) => {
  const [file, index] = fixture.key.split('#');
  const currentFixtureHash = digest(file), entry = read(file)[Number(index)];
  const input = adaptTestcaseEntry(entry);
  assert.deepEqual(JSON.parse(JSON.stringify(input)), fixture.input, `Changed captured input: ${fixture.key}`);
  assert.deepEqual(entry.game_report_result, fixture.game, `Changed survivor observations: ${fixture.key}`);
  const result = runPrepared(prepareBattle(input, current), 'hendrik-first-two-adoption-2026-09-07', { mode: 'trace' });
  assert(result.randomness.deterministic);
  const frozenPrediction = predicted.results.find((row: any) => row.key === fixture.key).predictions.s3_first_two;
  assert.equal(battleScoreDelta(result), frozenPrediction.score);
  assert.equal(result.winner, frozenPrediction.winner);
  assert.equal(result.rounds, frozenPrediction.rounds);
  assert.deepEqual(result.remaining, frozenPrediction.remaining);
  const heroSide = input.attacker.heroes?.Hendrik ? 'attacker' : 'defender';
  const hendrikReport = result.skillReport[heroSide].filter(row => ['WormsRavage', 'ArmorOfBarnacles', 'DragonsHeir'].includes(row.skillId));
  assert.deepEqual(JSON.parse(JSON.stringify(hendrikReport)), frozenPrediction.hendrikReport);
  assert.equal(digest(file), currentFixtureHash, `Fixture changed during verification: ${file}`);
  return { key: fixture.key, frozenFixtureSha256: fixture.fixtureSha256, currentFixtureSha256: currentFixtureHash,
    exactInputUnchanged: true, survivorObservationsUnchanged: true, matchesFrozenFirstTwo: true,
    game: entry.game_report_result, score: battleScoreDelta(result), remaining: result.remaining, winner: result.winner,
    rounds: result.rounds, deterministic: result.randomness.deterministic, hendrikReport };
});
for (const [file, expectedHash] of Object.entries(currentSourceHashes)) assert.equal(digest(file), expectedHash, `Source changed during verification: ${file}`);
for (const [file, expectedHash] of Object.entries(preservedHashes)) assert.equal(digest(resolve(dir, file)), expectedHash);
const output = resolve(dir, 'adoption.json');
assert(!existsSync(output), 'Preserve adoption verification.');
writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), interpretation: 'Post-adoption current-production verification; not new game evidence.',
  adoptedChange: 'Only Hendrik DragonsHeir trigger.first=2; every=3 and all S2 definition fields unchanged.',
  s2DefinitionUnchanged: true, otherConfigUnchanged: true, allRuntimeSourcesUnchanged: true, sourceChanges: changedSources,
  definitionSha256: currentSourceHashes[hendrikSource], configSha256: createHash('sha256').update(JSON.stringify(current, null, 2) + '\n').digest('hex'),
  sourceHashes: currentSourceHashes, preservedFrozenHashes: preservedHashes, results }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, definitionSha256: currentSourceHashes[hendrikSource], results: results.map(row => ({ key: row.key, score: row.score, remaining: row.remaining, matchesFrozenFirstTwo: true })) }));
