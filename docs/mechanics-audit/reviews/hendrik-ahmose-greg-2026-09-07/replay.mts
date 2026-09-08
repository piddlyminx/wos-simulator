import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSimulatorConfig } from '../../../../simulator/src/config-node';
import { adaptTestcaseEntry, battleScoreDelta } from '../../../../simulator/src/tooling/testcases';
import { compareOutcomeDistribution } from '../../../../simulator/src/tooling/parityMetrics';
import { BatchWorkerPool } from '../../../../simulator/src/workerPool';
import { WorkerThreadBatchWorker } from '../../../../scripts/workerThreadBatchWorker';

const dir = dirname(fileURLToPath(import.meta.url)), root = resolve(dir, '../../../..');
const output = resolve(dir, 'results.json');
assert(!existsSync(output), 'Preserve review results.');
const digest = (file: string) => createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
const read = (file: string) => JSON.parse(readFileSync(resolve(root, file), 'utf8'));
const config = loadSimulatorConfig(), configText = JSON.stringify(config, null, 2) + '\n';
writeFileSync(resolve(dir, 'config-snapshot.json'), configText, { flag: 'wx' });
const sourceFiles = readdirSync(resolve(root, 'simulator/src'), { recursive: true }).map(String)
  .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts')).map(file => `simulator/src/${file}`)
  .concat(['Hendrik', 'Ahmose', 'Greg'].map(hero => `simulator/config/hero_definitions/${hero}.json`));
const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file, digest(file)]));
const selections = [
  { hero: 'Hendrik', skill: 'WormsRavage' },
  { hero: 'Ahmose', skill: 'ViperFormation' }, { hero: 'Ahmose', skill: 'PrayerOfFlame' }, { hero: 'Ahmose', skill: 'BladeOfLight' },
  { hero: 'Greg', skill: 'SwordOfJustice' }, { hero: 'Greg', skill: 'DeterrenceOfLaw' },
];
const variants: Record<string, any> = { current: config }, variantDefinitions: Record<string, any> = {};
const bySkill: Record<string, string[]> = {};
for (const selection of selections) {
  const { hero, skill } = selection, key = `hero:${hero}:${skill}`;
  bySkill[key] = [];
  const add = (name: string, description: string, change: (skill: any) => void) => {
    const id = `${hero}.${skill}.${name}`, candidate = structuredClone(config);
    change(candidate.heroDefinitions[hero].skills[skill]); variants[id] = candidate;
    variantDefinitions[id] = { key, description }; bySkill[key].push(id);
  };
  add('omit', 'Omit only the selected skill effects in the simulator; retain the full recorded kit and other skills.', s => { s.effects = {}; });
  if (skill === 'WormsRavage') add('enemy_marksmen_only', 'Restrict persistent DefenseDown to enemy Marksmen, testing the all-enemy scope.', s => { s.effects['WormsRavage/1'].units.applies_to = 'enemy.marksman'; });
  if (skill === 'ViperFormation') {
    for (const [name, id] of [['omit_pause', 'ViperFormation/1'], ['omit_backline_protection', 'ViperFormation/2'], ['omit_infantry_protection', 'ViperFormation/3']])
      add(name, `Omit only ${id}, preserving its sibling components.`, s => { delete s.effects[id]; });
    add('protection_one_turn', 'Keep cadence and one-turn Infantry pause; make both protection components last one turn instead of two.', s => { s.effects['ViperFormation/2'].duration.turns.count = 1; s.effects['ViperFormation/3'].duration.turns.count = 1; });
    add('pause_two_turns', 'Keep protection unchanged; extend only the Infantry pause from one turn to two.', s => { s.effects['ViperFormation/1'].duration.turns.count = 2; });
  }
  if (skill === 'PrayerOfFlame') add('all_own_types', 'Broaden only the permanent Infantry offense effect to all own troop types.', s => { s.effects['PrayerOfFlame/1'].units.applies_to = 'all'; });
  if (skill === 'BladeOfLight') {
    add('omit_offense', 'Omit only the Infantry attack contribution; retain the delayed target debuff.', s => { delete s.effects['BladeOfLight/1']; });
    add('omit_target_debuff', 'Omit only the delayed target debuff; retain Infantry attack contribution.', s => { delete s.effects['BladeOfLight/2']; });
    add('debuff_immediate', 'Start the one-turn target debuff immediately instead of next turn, testing the documented ordering uncertainty.', s => { s.effects['BladeOfLight/2'].duration.turns.delay = 0; });
    add('debuff_two_turns', 'Retain next-turn onset; extend target debuff from one turn to two.', s => { s.effects['BladeOfLight/2'].duration.turns.count = 2; });
  }
  if (skill === 'SwordOfJustice') {
    add('marksmen_only', 'Restrict each offensive window to own Marksmen; preserve chance, duration and max stacking.', s => { s.effects['SwordOfJustice/1'].units.applies_to = 'marksman'; });
    add('duration_one', 'Retain chance/scope; make each offensive window last one turn instead of three.', s => { s.effects['SwordOfJustice/1'].duration.turns.count = 1; });
  }
  if (skill === 'DeterrenceOfLaw') {
    add('marksman_source_only', 'Permit only Marksman attacks to trigger the debuff; preserve target lock, chance and lifetime.', s => { s.trigger.source = 'marksman'; });
    add('all_enemy_targets', 'Broaden each debuff from the triggering target line to all enemies, testing the documented scope uncertainty.', s => { s.effects['DeterrenceOfLaw/1'].units.applies_to = 'enemy.any'; });
    add('immediate', 'Start the two-turn target debuff immediately instead of next turn, testing the documented ordering choice.', s => { s.effects['DeterrenceOfLaw/1'].duration.turns.delay = 0; });
    add('duration_one', 'Keep next-turn onset but shorten the target debuff from two turns to one.', s => { s.effects['DeterrenceOfLaw/1'].duration.turns.count = 1; });
  }
}
const fixtures = [
  ['testcases/emulator_verified/hendrik_armor_lancer_scope.json', 0],
  ['testcases/emulator_verified/hendrik_dragons_heir_250m_vs_400i_100l_100m.json', 0],
  ['testcases/emulator_verified/hendrik_small_timing_250m_vs_150i_60l_60m.json', 0],
  ['testcases/emulator_verified/renee_hendrik_defense_bucket_nc.json', 0],
  ['testcases/emulator_verified/ahmose_solo_nc.json', 0],
  ['testcases/emulator_verified/renee_ahmose_damage_taken_overlap_attacker_nc.json', 0],
  ['testcases/3-testcases_mixed-heroes-not-verified.json', 5],
  ['testcases/emulator_verified/greg_solo.json', 0],
  ['testcases/emulator_verified/norah_greg_combo.json', 0],
  ['testcases/emulator_verified/greg_mia_defender_current.json', 0],
  ['testcases/emulator_verified/greg_only_defender_current.json', 0],
  ['testcases/emulator_verified/greg_only_defender_current.json', 1],
  ['testcases/emulator_verified/greg_only_defender_current.json', 2],
].map(([file, index]: any) => {
  const entry = read(file)[index], input = adaptTestcaseEntry(entry);
  const active = selections.filter(({ hero, skill }) => {
    const slot = Object.keys(config.heroDefinitions[hero].skills).indexOf(skill) + 1;
    return ['attacker', 'defender'].some(side => Number(entry[side]?.heroes?.[hero]?.[`skill_${slot}`] ?? 0) > 0);
  }).map(({ hero, skill }) => `hero:${hero}:${skill}`);
  const gameOutcomes = Array.isArray(entry.game_report_result) ? entry.game_report_result : [entry.game_report_result];
  return { key: `${file}#${index}`, fixtureSha256: digest(file), input, gameOutcomes, game: gameOutcomes.map(battleScoreDelta), skills: active,
    variantNames: ['current', ...active.flatMap(key => bySkill[key])] };
});
const options = { repeat: 1000, workers: 4, seed: 'hendrik-ahmose-greg-review-2026-09-07' };
writeFileSync(resolve(dir, 'definitions.json'), JSON.stringify({ frozenAt: new Date().toISOString(), phase: 'retrospective_existing_accepted_outcomes',
  interpretation: 'All selected recorded outcomes accepted unless explicitly invalid/obsolete; no such flags on selected entries. All existing outcomes were available before this retrospective definition. Full kits and individual input sets preserved; no coefficient fitting or production edits. S3 first2 Hendrik is current. Variants are simulator counterfactuals, not live-disabled skills.',
  options, selections, variantDefinitions, sourceHashes, configSha256: createHash('sha256').update(configText).digest('hex'), fixtures }, null, 2) + '\n', { flag: 'wx' });
const effectIds = selections.flatMap(({ hero, skill }) => Object.keys(config.heroDefinitions[hero].skills[skill].effects));
const skillIds = selections.map(({ skill }) => skill);
const total = (fighter: any) => Object.values(fighter.troops).reduce((sum: number, count: any) => sum + count, 0);
const pool = new BatchWorkerPool(options.workers, () => new WorkerThreadBatchWorker(new URL('./worker.mts', import.meta.url)));
try {
  const results = await Promise.all(fixtures.map(async fixture => {
    const predictions = Object.fromEntries(await Promise.all(fixture.variantNames.map(async name => {
      const result: any = await pool.runTask({ input: fixture.input, config: variants[name], repeat: options.repeat, seed: `${options.seed}:${fixture.key}`, effectIds, skillIds });
      const comparison = compareOutcomeDistribution({ candidate: { samples: result.samples }, reference: { samples: fixture.game },
        initialTroops: total(fixture.input.attacker) + total(fixture.input.defender), outcomeRange: { min: -total(fixture.input.defender), max: total(fixture.input.attacker) }, deterministic: result.deterministic });
      console.log(JSON.stringify({ key: fixture.key, name, n: result.samples.length, game: fixture.game, mean: comparison.mu_candidate, sd: comparison.sigma_candidate, p: comparison.p }));
      return [name, { ...result, comparison }];
    })));
    assert.equal(digest(fixture.key.split('#')[0]), fixture.fixtureSha256, `Fixture changed: ${fixture.key}`);
    return { ...fixture, predictions };
  }));
  for (const [file, expected] of Object.entries(sourceHashes)) assert.equal(digest(file), expected, `Source changed: ${file}`);
  assert.equal(JSON.stringify(loadSimulatorConfig(), null, 2) + '\n', configText, 'Config changed during review.');
  writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), definitionsSha256: digest(resolve(dir, 'definitions.json')), options,
    scoring: 'Surviving attackers minus defenders for both game and simulator, including draws. Every simulation retains per-type survivor counts, winner and rounds.', results }, null, 2) + '\n', { flag: 'wx' });
} finally { await pool.close(); }
