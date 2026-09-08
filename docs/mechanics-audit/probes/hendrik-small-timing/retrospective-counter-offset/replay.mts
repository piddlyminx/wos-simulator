import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBattle, runPrepared } from '../../../../../simulator/src/simulator';
import { battleScoreDelta } from '../../../../../simulator/src/tooling/testcases';

const dir = dirname(fileURLToPath(import.meta.url)), root = resolve(dir, '../../../../..');
const digest = (file: string) => createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
const definitionsFile = resolve(dir, 'definitions.json');
const definitionHash = digest(definitionsFile);
const definitions = JSON.parse(readFileSync(definitionsFile, 'utf8'));
const configFile = resolve(dir, 'config-snapshot.json');
assert.equal(digest(configFile), definitions.configSha256);
for (const [file, expected] of Object.entries(definitions.sourceHashes)) assert.equal(digest(file), expected, `Source changed: ${file}`);
const base = JSON.parse(readFileSync(configFile, 'utf8'));
const output = resolve(dir, 'results.json');
assert(!existsSync(output), 'Preserve frozen results.');
const configs = Object.fromEntries(Object.entries(definitions.variants).map(([name, variant]: [string, any]) => {
  const config = structuredClone(base), skills = config.heroDefinitions.Hendrik.skills;
  const effect = skills.ArmorOfBarnacles.effects['ArmorOfBarnacles/1'];
  if (variant.s2First !== undefined) skills.ArmorOfBarnacles.trigger.first = variant.s2First;
  if (variant.s3First !== undefined) skills.DragonsHeir.trigger.first = variant.s3First;
  if (variant.s2Delay !== undefined) effect.duration.turns.delay = variant.s2Delay;
  if (variant.s2Duration !== undefined) effect.duration.turns.count = variant.s2Duration;
  if (variant.s2Type !== undefined) effect.type = variant.s2Type;
  return [name, config];
}));
const results = definitions.fixtures.map((fixture: any) => {
  const heroSide = fixture.input.attacker.heroes?.Hendrik ? 'attacker' : 'defender';
  const predictions = Object.fromEntries(Object.entries(configs).map(([name, config]) => {
    const result = runPrepared(prepareBattle(fixture.input, config), 'hendrik-counter-offset-retrospective-2026-09-07', { mode: 'trace' });
    assert(result.randomness.deterministic, `Stochastic full kit requires a distribution: ${fixture.key}`);
    const jobs = result.attacks.filter(job => job.sourceEffectId === 'DragonsHeir/1');
    const prediction = { score: battleScoreDelta(result), winner: result.winner, remaining: result.remaining, rounds: result.rounds,
      deterministic: result.randomness.deterministic,
      hendrikReport: result.skillReport[heroSide].filter(row => ['WormsRavage', 'ArmorOfBarnacles', 'DragonsHeir'].includes(row.skillId)),
      s2UsedRounds: [...new Set(result.attacks.filter(job => job.appliedEffects?.some(effect => effect.effectId === 'ArmorOfBarnacles/1')).map(job => job.round))],
      s3Jobs: jobs.map(job => ({ round: job.round, kind: job.kind, target: job.takerUnit, kills: job.kills })),
      s3TotalKills: jobs.reduce((sum, job) => sum + job.kills, 0) };
    return [name, prediction];
  }));
  console.log(JSON.stringify({ key: fixture.key, game: fixture.game, predictions: Object.fromEntries(Object.entries(predictions).map(([name, value]: [string, any]) => [name,
    { score: value.score, defender: value.remaining.defender, rounds: value.rounds, activations: value.hendrikReport.map((row: any) => [row.skillId, row.skillActivations]) }])) }));
  return { ...fixture, predictions };
});
assert.equal(digest(definitionsFile), definitionHash);
for (const [file, expected] of Object.entries(definitions.sourceHashes)) assert.equal(digest(file), expected, `Source changed during replay: ${file}`);
writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), definitionSha256: definitionHash,
  interpretation: 'Retrospective fixed named hypotheses; all totals known. Reported activation counts are auxiliary observations, not observed round numbers. No production edits or coefficient fitting.',
  results }, null, 2) + '\n', { flag: 'wx' });
