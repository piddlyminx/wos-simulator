import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSimulatorConfig } from '../../../simulator/src/config-node';
import { prepareBattle, runPrepared, signedRemainingScore } from '../../../simulator/src/simulator';
import { adaptTestcaseEntry } from '../../../simulator/src/tooling/testcases';
import { compareOutcomeDistribution } from '../../../simulator/src/tooling/parityMetrics';

const dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(dir, '../../..');
const outputPath = resolve(process.argv[2] ?? resolve(dir, 'troops-2026-09-07-replay.json'));
assert(!existsSync(outputPath), 'Preserve review output; provide a new replay path');
const config = loadSimulatorConfig();
const seed = 'troop-evidence-review-2026-09-07';
const selections = [
  { id: 'norah_s2_splash_C_nc', skill: 'MasterBrawler' },
  { id: 'type_triangle_B_nc', skill: 'MasterBrawler' },
  { id: 'wos451_bradley_s21_lancer_damage_up_control', skill: 'Charge' },
  { id: 'renee_charge_single_target_bucket_nc', skill: 'Charge' },
  { id: 'wos451_bradley_s22_infantry_damage_up_control', skill: 'RangedStrike' },
  { id: 'renee_hendrik_defense_bucket_nc', skill: 'BandsOfSteel' },
  { id: 'ambusher_logan_renee_vs_logan_patrick_nc', skill: 'Ambusher' },
];
const sourcePaths = ['simulator/config/troop_skills.json', 'simulator/src/simulator.ts', 'simulator/src/fighterResolution.ts',
  'simulator/src/effectIndex.ts', 'simulator/src/damageBuckets.ts', 'simulator/src/damage.ts', 'simulator/src/runtime.ts',
  'simulator/src/tooling/parityMetrics.ts', 'simulator/config/hero_definitions/Renee.json', 'simulator/config/hero_definitions/Hendrik.json',
  'simulator/config/hero_definitions/Logan.json', 'simulator/config/hero_definitions/Patrick.json'];
const results = Object.fromEntries(selections.map(({ id, skill }) => {
  const path = `testcases/emulator_verified/${id}.json`;
  sourcePaths.push(path);
  const fixture = JSON.parse(readFileSync(resolve(root, path), 'utf8'))[0];
  const input = adaptTestcaseEntry(fixture);
  const gameScores = fixture.game_report_result.map((row: any) => row.attacker - row.defender);
  const initial = Object.fromEntries(['attacker', 'defender'].map(side => [side,
    Object.values(input[side].troops).reduce((sum: number, value: number) => sum + value, 0)]));
  const variants: Record<string, any> = { current: config, omitted: structuredClone(config) };
  variants.omitted.troopSkills.skills[skill].effects = {};
  if (skill === 'Ambusher') {
    delete variants.omitted.troopSkills.skills[skill];
    for (const probability of [10, 30]) {
      const variant = structuredClone(config);
      variant.troopSkills.skills.Ambusher.trigger.probability = [probability];
      variants[`chance_${probability}`] = variant;
    }
  }
  const predictions = Object.fromEntries(Object.entries(variants).map(([name, variant]) => {
    const prepared = prepareBattle(input, variant);
    const first = runPrepared(prepared, `${seed}:${id}#0`, { mode: 'trace' });
    const count = first.randomness.deterministic ? 1 : 2000;
    const samples = [signedRemainingScore(first), ...Array.from({ length: count - 1 }, (_, index) =>
      signedRemainingScore(runPrepared(prepared, `${seed}:${id}#${index + 1}`, { mode: 'fast' })))];
    const common = { candidate: { samples }, reference: { samples: gameScores },
      initialTroops: initial.attacker + initial.defender,
      outcomeRange: { min: -initial.defender, max: initial.attacker }, deterministic: first.randomness.deterministic };
    const effectApplications = first.attacks.flatMap(attack => (attack.appliedEffects ?? [])
      .filter(effect => effect.effectId.startsWith(`${skill}/`))
      .map(effect => `${effect.effectId}:${attack.kind}:${attack.dealerSide}.${attack.dealerUnit}->${attack.takerSide}.${attack.takerUnit}`));
    return [name, { deterministic: first.randomness.deterministic, sampleCount: count, samples,
      metrics: compareOutcomeDistribution(common),
      maxAbsError: first.randomness.deterministic ? Math.max(...gameScores.map((score: number) => Math.abs(score - samples[0]))) : null,
      ...(id.startsWith('ambusher_') ? { excludingInconsistentTrial2: compareOutcomeDistribution({ ...common,
        reference: { samples: gameScores.filter((_: number, index: number) => index !== 1) } }) } : {}),
      firstSample: { score: samples[0], rounds: first.rounds, remaining: first.remaining,
        troopSkillReport: [...first.skillReport.attacker, ...first.skillReport.defender].filter(row => row.sourceKind === 'troop_skill'),
        appliedReviewedEffects: Object.fromEntries([...new Set(effectApplications)].map(key => [key, effectApplications.filter(value => value === key).length])) } }];
  }));
  return [id, { fixtureKey: `${path}#0`, reviewedSkill: skill, input, gameOutcomes: fixture.game_report_result, gameScores,
    ...(id.startsWith('ambusher_') ? { transcriptionCaution: 'Trial2 stores attacker581/defender9, but its per-line table sums attacker590/defender0. Original signed572 is preserved. Excluding this trial is only a diagnostic sensitivity, not a corrected observation.', observedSkillCounts: fixture.metadata.observed_battle_outcomes.map((row: any) => row.skill_counts) } : {}),
    predictions }];
}));
const output = { generatedAt: new Date().toISOString(), seed, stochasticReplicates: 2000,
  reviewType: 'Retrospective accepted-game evidence review. Outcomes known before replay. Omission/probability variants change only simulator configuration; exact troop/FC keys and full hero kits are preserved.',
  variantDefinitions: { current: 'Current source configuration', omitted: 'Only selected troop skill effects removed; Ambusher definition removed to remove its otherwise unused RNG draws',
    chance_10: 'Only Ambusher chance changes20% to10%', chance_30: 'Only Ambusher chance changes20% to30%' },
  sourceHashes: Object.fromEntries(sourcePaths.map(path => [path, createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')])), results };
writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([id, row]: [string, any]) => [id,
  Object.fromEntries(Object.entries(row.predictions).map(([name, p]: [string, any]) => [name, { metrics: p.metrics, maxAbsError: p.maxAbsError, excludingTrial2: p.excludingInconsistentTrial2 }]))])), null, 2));
