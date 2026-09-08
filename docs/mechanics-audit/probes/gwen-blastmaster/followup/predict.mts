import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBattle, runPrepared, signedRemainingScore } from '../../../../../simulator/src/simulator';

const dir = dirname(fileURLToPath(import.meta.url));
const inputPath = resolve(process.argv[2] ?? resolve(dir, 'input.json'));
const outputPath = resolve(process.argv[3] ?? resolve(dir, 'prediction.json'));
const prospective = process.argv[4] === 'prospective';
assert(!(outputPath === resolve(dir, 'prediction.json') && existsSync(outputPath)), 'Preserve original prediction.json; provide a new replay output path');
const snapshotPath = resolve(dir, '../config-snapshot.json');
const snapshot = readFileSync(snapshotPath, 'utf8');
const configHash = createHash('sha256').update(snapshot).digest('hex');
assert.equal(configHash, 'bcb0d3068845ca143802c6e59cd7a530a8440606133b770613c418bed425b17c');
const frozen = JSON.parse(snapshot);
const inputText = readFileSync(inputPath, 'utf8');
const input = JSON.parse(inputText);
const definitions = {
  unchanged: { first: 5, every: 4, target: 'enemy.living' },
  every_fifth: { first: 5, every: 5, target: 'enemy.living' },
  first_sixth_every_fourth: { first: 6, every: 4, target: 'enemy.living' },
  every_fifth_current_target: { first: 5, every: 5, target: 'use.target' },
};
const fields = [...['attack', 'defense', 'lethality', 'health'].map(stat => ['attacker', 'mark', stat]),
  ...['inf', 'lanc', 'mark'].flatMap(unit => ['attack', 'defense', 'lethality', 'health'].map(stat => ['defender', unit, stat]))];
let state = 20260907;
const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
const vectors = Array.from({ length: 256 }, () => fields.map(() => (random() - .5) * .1));
for (let i = 0; i < fields.length; i++) for (const v of [-.05, .05]) vectors.push(fields.map((_, j) => i === j ? v : 0));
for (const sign of [-1, 1]) vectors.push(fields.map(([side]) => (side === 'attacker' ? sign : -sign) * .05));
const candidates = Object.fromEntries(Object.entries(definitions).map(([name, definition]) => {
  const config = structuredClone(frozen);
  const skill = config.heroDefinitions.Gwen.skills.Blastmaster;
  skill.trigger = { ...skill.trigger, first: definition.first, every: definition.every };
  skill.effects['Blastmaster/1'].trigger_damage_jobs[0].target = definition.target;
  const result = runPrepared(prepareBattle(input, config), 'gwen-cadence-followup', { mode: 'trace' });
  assert(result.randomness.deterministic);
  const sensitivity = vectors.map(vector => {
    const varied = structuredClone(input);
    fields.forEach(([side, unit, stat], i) => varied[side].stats[unit][stat] += vector[i]);
    const trial = runPrepared(prepareBattle(varied, config), 'gwen-cadence-followup', { mode: 'fast' });
    return { score: signedRemainingScore(trial), minDefenderLine: Math.min(...Object.values(trial.remaining.defender)) };
  });
  return [name, { signedRemaining: signedRemainingScore(result), rounds: result.rounds, remaining: result.remaining,
    randomness: result.randomness, heroReport: result.skillReport.attacker.filter(row => row.sourceKind === 'hero_skill'),
    blastmasterJobs: result.attacks.filter(attack => attack.sourceEffectId === 'Blastmaster/1').map(attack => ({ round: attack.round, target: attack.takerUnit, rawKills: attack.kills })),
    statSensitivity: { samples: sensitivity.length, min: Math.min(...sensitivity.map(row => row.score)), max: Math.max(...sensitivity.map(row => row.score)), minDefenderLine: Math.min(...sensitivity.map(row => row.minDefenderLine)) } }];
}));
writeFileSync(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), phase: prospective ? 'prospective_followup' : 'frozen_candidate_replay',
  inputPath, inputSha256: createHash('sha256').update(inputText).digest('hex'), input,
  configSnapshot: snapshotPath, configSnapshotSha256: configHash, candidateDefinitions: definitions,
  provenance: { designExposure: 'The first 800-Marksman versus 600-each report (1397 defenders) was observed before designing this follow-up. These are competing Blastmaster timing/fanout hypotheses selected from that retrospective discrepancy.',
    forecastExposure: prospective ? 'No result from this new 800-Marksman versus 1200/100/100 formation was opened before this prediction was frozen.' : 'Replay after capture with the same frozen hypothesis definitions; preserve the original prospective prediction.',
    statsSource: prospective ? 'Exact displayed stats from testcases/emulator_verified/gwen_blastmaster_fanout_800m_vs_600_each.json, with troop counts changed for the new prospective formation. Account state may change; replace with the follow-up report stats after capture.' : 'Report-resolved stats supplied by the inputPath BattleInput; no hero-generation bonus is added.',
    fullKit: 'Freshly confirmed minxxx Gwen 3/1/1; no skill disabled. WIP no heroes. All troops T6.' },
  uncertainty: { statInterval: [-.05, .05], fields, seed: 20260907, note: '290 shared stat vectors: 256 interior, 32 coordinate endpoints, 2 common favorable corners. Sensitivity screen, not an exhaustive interval proof.' }, candidates }, null, 2) + '\n');
console.log(JSON.stringify({ outputPath, candidates: Object.fromEntries(Object.entries(candidates).map(([name, row]: [string, any]) => [name, { score: row.signedRemaining, rounds: row.rounds, remaining: row.remaining, sensitivity: row.statSensitivity }])) }, null, 2));
