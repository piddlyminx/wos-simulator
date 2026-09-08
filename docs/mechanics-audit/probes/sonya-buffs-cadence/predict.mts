import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBattle, runPrepared, signedRemainingScore } from '../../../../simulator/src/simulator';

const dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(dir, '../../../..');
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const manifest = read(resolve(dir, 'manifest.json'));
for (const [path, hash] of Object.entries(manifest.guardedFiles)) {
  assert.equal(digest(readFileSync(resolve(root, path))), hash, `Frozen file or simulator source changed: ${path}`);
}
const inputPath = resolve(process.argv[2] ?? resolve(dir, 'estimated-input.json'));
const outputPath = resolve(process.argv[3] ?? resolve(dir, 'prediction.json'));
const prospective = process.argv[4] === 'prospective';
assert(!existsSync(outputPath), 'Preserve existing artifacts; provide a new output path');
if (prospective) assert.equal(inputPath, resolve(dir, 'estimated-input.json'));
const inputText = readFileSync(inputPath, 'utf8');
const input = JSON.parse(inputText);
const spec = read(resolve(dir, 'spec.json'));
for (const side of ['attacker', 'defender']) {
  assert.deepEqual(input[side].troops, spec[side].troops, `Replay must preserve ${side} troop formation`);
  assert.deepEqual(input[side].heroes, spec[side].heroes, `Replay must preserve ${side} full hero kit`);
  assert.deepEqual(input[side].joiner_heroes ?? {}, {}, 'Probe has no joiners');
}
assert.equal(input.engagement_type ?? 'solo', 'solo');
const snapshot = read(resolve(dir, 'config-snapshot.json'));
const definitions = read(resolve(dir, 'candidates.json'));
const fields = [
  ...['attack', 'defense', 'lethality', 'health'].map(stat => ['attacker', 'inf', stat]),
  ...['inf', 'lanc', 'mark'].flatMap(unit => ['attack', 'defense', 'lethality', 'health'].map(stat => ['defender', unit, stat])),
];
for (const [side, unit, stat] of fields) assert(Number.isFinite(input[side].stats[unit][stat]));
let state = 20260907;
const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
const vectors = Array.from({ length: 256 }, () => fields.map(() => (random() - .5) * .1));
for (let index = 0; index < fields.length; index++) {
  for (const sign of [-1, 1]) vectors.push(fields.map((_, i) => i === index ? sign * .05 : 0));
}
for (const sign of [-1, 1]) vectors.push(fields.map(([side]) => (side === 'attacker' ? sign : -sign) * .05));
const candidates = Object.fromEntries(Object.entries(definitions).map(([name, definition]: [string, any]) => {
  const config = structuredClone(snapshot);
  for (const patch of definition.patches) {
    const object = patch.path.slice(0, -1).reduce((current: any, key: string) => current[key], config);
    const key = patch.path.at(-1);
    assert.deepEqual(object[key] ?? null, patch.from, `Candidate patch source changed: ${name}`);
    object[key] = structuredClone(patch.to);
  }
  const result = runPrepared(prepareBattle(input, config), 'sonya-buffs-cadence-2026-09-07', { mode: 'trace' });
  assert(result.randomness.deterministic, `Unexpected chance in ${name}`);
  const sensitivity = vectors.map(vector => {
    const varied = structuredClone(input);
    fields.forEach(([side, unit, stat], index) => varied[side].stats[unit][stat] += vector[index]);
    const trial = runPrepared(prepareBattle(varied, config), 'sonya-buffs-cadence-2026-09-07', { mode: 'fast' });
    return { signedRemaining: signedRemainingScore(trial), rounds: trial.rounds, defenderInfantry: trial.remaining.defender.infantry };
  });
  const bountyJobs = result.attacks.filter(attack => attack.sourceEffectId === 'BountyTemptation/1');
  return [name, {
    signedRemaining: signedRemainingScore(result), winner: result.winner, rounds: result.rounds,
    remaining: result.remaining, randomness: result.randomness,
    heroReport: result.skillReport.defender.filter(row => row.sourceKind === 'hero_skill'),
    bountyJobs: bountyJobs.map(attack => ({ round: attack.round, target: attack.takerUnit, kind: attack.kind, rawKills: attack.kills })),
    sampledStatPrecision: { count: sensitivity.length,
      min: Math.min(...sensitivity.map(row => row.signedRemaining)), max: Math.max(...sensitivity.map(row => row.signedRemaining)),
      rounds: [...new Set(sensitivity.map(row => row.rounds))],
      minDefenderInfantry: Math.min(...sensitivity.map(row => row.defenderInfantry)) },
    statSensitivitySamples: sensitivity,
  }];
}));
const output = {
  generatedAt: new Date().toISOString(), phase: prospective ? 'prospective_conditional_prediction' : 'frozen_candidate_replay',
  manifestSha256: digest(readFileSync(resolve(dir, 'manifest.json'))), inputPath, inputSha256: digest(inputText), input,
  candidateDefinitions: definitions,
  provenance: {
    outcomeExposure: prospective ? 'No Sonya game outcome from this formation has been opened; simulator-only formation screening preceded the freeze.' : 'Replay with frozen candidates and supplied input; preserve original prospective prediction. This replay is not itself a game observation.',
    stats: prospective ? 'Exact displayed stats from the first Gwen report, 2026-09-07 05:05:04, used only as a conditional starting input. WIP Sonya changes the hero and Lancer class stats; replace all stats with this battle report after capture. Account or hero changes are not bounded by the precision sweep.' : 'Caller supplied report-resolved stats. No hero-generation bonus is added; verify report identity and full input before interpretation.',
    kit: 'WIP Sonya 1/1/0, minxxx no heroes, no joiners, all T6. S3 is locked on this account, not artificially disabled.',
  },
  uncertainty: { reportStatOffsets: [-.05, .05], fields, seed: 20260907,
    vectors, note: '290 shared stat vectors: 256 interior, 32 coordinate endpoints, 2 favorable/opposing corners. A sensitivity screen, not an exhaustive bound; no account-state drift allowance.' },
  candidates,
};
writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ outputPath, candidates: Object.fromEntries(Object.entries(candidates).map(([name, row]: [string, any]) => [name, {
  score: row.signedRemaining, rounds: row.rounds, remaining: row.remaining.defender, precision: row.sampledStatPrecision,
}])) }, null, 2));
