import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSimulatorConfig } from '../../../simulator/src/config-node';
import { prepareBattle, runPrepared, signedRemainingScore } from '../../../simulator/src/simulator';
import { adaptTestcaseEntry } from '../../../simulator/src/tooling/testcases';

const dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(dir, '../../..');
const priorPath = resolve(dir, 'wu-ming-2026-09-07.json');
if (existsSync(priorPath)) {
  const prior = JSON.parse(readFileSync(priorPath, 'utf8'));
  for (const [path, expected] of Object.entries(prior.sourceHashes)) {
    if (createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex') !== expected)
      throw Error(`Frozen Wu review source changed: ${path}; use the separate outer-army-ceil/adoption-check.mts replay.`);
  }
}
const config = loadSimulatorConfig();
const variants: Record<string, any> = { current: config };
function variant(name: string, change: (config: any) => void) {
  variants[name] = structuredClone(config); change(variants[name]);
}
variant('omit_s1', c => c.heroDefinitions.WuMing.skills.ShadowsEvasion.effects = {});
variant('omit_s2', c => c.heroDefinitions.WuMing.skills.CrescentUplift.effects = {});
variant('s1_normal_18', c => c.heroDefinitions.WuMing.skills.ShadowsEvasion.effects['ShadowsEvasion/1'].value[2] = 18);
variant('s1_all_troops', c => Object.values(c.heroDefinitions.WuMing.skills.ShadowsEvasion.effects).forEach((effect: any) => effect.units.applies_to = 'all'));
variant('s2_separate_normal_bucket', c => c.heroDefinitions.WuMing.skills.CrescentUplift.effects['CrescentUplift/1'].type = 'type.normal.damage.up');
variant('s3_whole_normal', c => {
  const effect = c.heroDefinitions.WuMing.skills.ElementalResonance.effects['ElementalResonance/1'];
  effect.type = 'type.normal.damage.up'; effect.applies_to_damage_kinds = ['normal'];
});
variant('s3_ranged_strike_increment', c => c.troopSkills.skills.RangedStrike.effects['RangedStrike/1'].value[0] *= 1.15);
const caseVariants: Record<string, string[]> = {
  wu_ming_s1_isolation_nc: ['current', 'omit_s1', 'omit_s2', 's1_normal_18', 's3_whole_normal'],
  wu_ming_s2_isolation_nc: ['current', 'omit_s2', 's1_all_troops', 's3_whole_normal'],
  wu_ming_marksman_vs_infantry_nc: ['current', 's3_ranged_strike_increment', 's3_whole_normal'],
  wu_ming_bradley_current_nc: ['current', 's2_separate_normal_bucket', 's3_whole_normal'],
  wu_ming_solo_current_nc: ['current'],
  wu_ming_rounding_followup_nc: ['current'],
  renee_wu_ming_s1_damage_kind_nc: ['current'],
  retarget_lancer_screen_nc: ['current'],
  wu_ming_solo_superseded: ['current'],
};
const results = Object.fromEntries(Object.entries(caseVariants).map(([id, names]) => {
  const path = id === 'wu_ming_solo_superseded' ? 'docs/mechanics-audit/reviews/wu-ming-solo-superseded.json' : `testcases/emulator_verified/${id}.json`;
  const fixtureText = readFileSync(resolve(root, path), 'utf8');
  const fixture = JSON.parse(fixtureText)[0];
  const input = adaptTestcaseEntry(fixture);
  const predictions = Object.fromEntries(names.map(name => {
    const result = runPrepared(prepareBattle(input, variants[name]), 'wu-reviewed-evidence', { mode: 'trace' });
    const applications = result.attacks.flatMap(attack => (attack.appliedEffects ?? [])
      .filter(effect => /^(ShadowsEvasion|CrescentUplift|ElementalResonance)\//.test(effect.effectId))
      .map(effect => `${effect.effectId}:${attack.kind}:${attack.dealerSide}.${attack.dealerUnit}->${attack.takerSide}.${attack.takerUnit}`));
    return [name, { score: signedRemainingScore(result), rounds: result.rounds, remaining: result.remaining,
      deterministic: result.randomness.deterministic, skillJobs: result.attacks.filter(attack => attack.kind === 'skill').length,
      appliedWuEffects: Object.fromEntries([...new Set(applications)].map(key => [key, applications.filter(value => value === key).length])) }];
  }));
  return [id, { fixtureKey: `${path}#0`, ...(id === 'wu_ming_solo_superseded' ? {
    archivedFrom: '87cbbeac^:testcases/emulator_verified/wu_ming_solo_current_nc.json', activeFixture: false,
  } : { activeFixture: true }), sourceSha256: createHash('sha256').update(fixtureText).digest('hex'), input,
    gameOutcomes: fixture.game_report_result, predictions }];
}));
const sources = ['simulator/config/hero_definitions/WuMing.json', 'simulator/config/hero_definitions/Bradley.json',
  'simulator/config/hero_definitions/Renee.json', 'simulator/config/troop_skills.json',
  'simulator/src/effectIndex.ts', 'simulator/src/damageBuckets.ts', 'simulator/src/simulator.ts', 'simulator/src/damage.ts',
  'docs/mixed-target-parity-investigation-2026-08.md', 'docs/attack-trigger-regime-2026-08.md'];
writeFileSync(resolve(dir, 'wu-ming-2026-09-07.json'), JSON.stringify({ generatedAt: new Date().toISOString(),
  reviewType: 'Retrospective replay of accepted in-game fixtures; all outcomes were already known. Current narrow counterfactuals are simulator diagnostics, not new in-game observations.',
  sourceHashes: Object.fromEntries(sources.map(path => [path, createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')])),
  variantDefinitions: { omit_s1: 'Remove both S1 effects only in simulator', omit_s2: 'Remove S2 effect only in simulator',
    s1_normal_18: 'Level3 normal-damage denominator value15 becomes18', s1_all_troops: 'Broaden both S1 target scopes from Infantry to all own troops',
    s2_separate_normal_bucket: 'Move S2 from active.hero.damage.up to type.normal.damage.up',
    s3_whole_normal: 'Move S3 to type.normal.damage.up and restrict it to normal jobs',
    s3_ranged_strike_increment: 'For the single-line Marksman fixture only, increase Ranged Strike10 to11.5 as the old15%-amplified increment counterfactual' }, results }, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([id, result]: [string, any]) => [id,
  Object.fromEntries(Object.entries(result.predictions).map(([name, prediction]: [string, any]) => [name, { score: prediction.score, rounds: prediction.rounds, skillJobs: prediction.skillJobs }]))])), null, 2));
