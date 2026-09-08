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
  .concat(['Alonso', 'Bahiti', 'Flint'].map(hero => `simulator/config/hero_definitions/${hero}.json`));
const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file, digest(file)]));
const selections = [
  { hero: 'Alonso', skill: 'Onslaught' }, { hero: 'Alonso', skill: 'IronStrength' }, { hero: 'Alonso', skill: 'PoisonHarpoon' },
  { hero: 'Bahiti', skill: 'SixthSense' }, { hero: 'Bahiti', skill: 'Fluorescence' },
  { hero: 'Flint', skill: 'Pyromaniac' }, { hero: 'Flint', skill: 'BurningResolve' }, { hero: 'Flint', skill: 'Immolation' },
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
  if (skill === 'Onslaught') {
    add('marksmen_only', 'Restrict the offensive window to own Marksmen, preserving chance and lifetime.', s => { s.effects['Onslaught/1'].units = { applies_to: 'marksman' }; });
    add('duration_two', 'Extend each offensive window from one to two turns, preserving chance and scope.', s => { s.effects['Onslaught/1'].duration.turns.count = 2; });
  }
  if (skill === 'IronStrength') {
    add('marksman_source_only', 'Permit only Marksman attacks to trigger the debuff; preserve chance, target lock and lifetime.', s => { s.trigger.source = 'marksman'; });
    add('all_enemy_targets', 'Broaden debuff recipients from the triggering target line to all enemies, testing the description/current-scope discrepancy.', s => { s.effects['IronStrength/1'].units.applies_to = 'enemy.any'; });
    add('immediate', 'Start the two-turn target debuff immediately instead of next turn.', s => { s.effects['IronStrength/1'].duration.turns.delay = 0; });
    add('duration_one', 'Keep next-turn onset but shorten the target debuff from two turns to one.', s => { s.effects['IronStrength/1'].duration.turns.count = 1; });
  }
  if (skill === 'PoisonHarpoon') add('marksman_source_only', 'Permit only Marksman attacks to trigger the extra job, preserving probability, coefficient and target.', s => { s.trigger.source = 'marksman'; });
  if (skill === 'SixthSense') add('marksmen_only', 'Restrict persistent protection to own Marksmen instead of all own troop types.', s => { s.effects['SixthSense/1'].units = { applies_to: 'marksman' }; });
  if (skill === 'Fluorescence') {
    add('marksman_source_only', 'Permit only Marksman attacks to trigger the one-attack offensive modifier.', s => { s.trigger.source = 'marksman'; });
    add('one_turn_lifetime', 'Keep chance and source binding but retain the modifier for one turn instead of one attack; tests possible spillover into extra jobs.', s => { s.effects['Fluorescence/1'].duration = { turns: { count: 1 } }; });
  }
  if (skill === 'Pyromaniac') add('all_own_types', 'Broaden permanent damage-up from Infantry to all own troop types.', s => { s.effects['Pyromaniac/1'].units.applies_to = 'all'; });
  if (skill === 'BurningResolve' || skill === 'Immolation') add('infantry_only', 'Restrict the permanent all-own offensive modifier to Infantry only.', s => { s.effects[`${skill}/1`].units = { applies_to: 'infantry' }; });
}
const inventory = read('docs/mechanics-audit/inventory.json');
const selectedKeys = selections.map(({ hero, skill }) => `hero:${hero}:${skill}`);
const fixtureKeys = [...new Set(selectedKeys.flatMap(key => {
  const definition = inventory.definitions.find((row: any) => row.key === key);
  assert(definition, key);
  assert.equal(digest(definition.source), definition.source_sha256, `Definition changed since inventory: ${key}`);
  return definition.coverage.fixture_keys;
}))].sort();
const fixtures = fixtureKeys.map((key: string) => {
  const [file, index] = key.split('#'), inventoryFixture = inventory.fixtures.find((row: any) => row.key === key);
  assert.equal(inventoryFixture?.provenance.game_evidence_status, 'accepted_game_evidence', key);
  const entry = read(file)[Number(index)], input = adaptTestcaseEntry(entry);
  const active = selections.filter(({ hero, skill }) => {
    const slot = Object.keys(config.heroDefinitions[hero].skills).indexOf(skill) + 1;
    return ['attacker', 'defender'].some(side => Number(entry[side]?.heroes?.[hero]?.[`skill_${slot}`] ?? 0) > 0);
  }).map(({ hero, skill }) => `hero:${hero}:${skill}`);
  const gameOutcomes = Array.isArray(entry.game_report_result) ? entry.game_report_result : [entry.game_report_result];
  return { key, fixtureSha256: digest(file), input, gameOutcomes, game: gameOutcomes.map(battleScoreDelta), skills: active,
    variantNames: ['current', ...active.flatMap(key => bySkill[key])] };
});

const options = { repeat: 1000, workers: 4, seed: 'alonso-bahiti-flint-review-2026-09-07' };
writeFileSync(resolve(dir, 'definitions.json'), JSON.stringify({ frozenAt: new Date().toISOString(), phase: 'retrospective_existing_accepted_outcomes',
  interpretation: 'All selected recorded outcomes accepted unless explicitly invalid/obsolete; no such flags on selected entries. All existing outcomes were available before this retrospective definition. Full kits and individual input sets preserved; no coefficient fitting or production edits. Current runtime retains fractional survivor state and ceils surviving attack-source troops; outer army-term ceil is absent. Distinct entries are not assumed to represent independent captures; no repeated outcome is silently merged. Bilateral Alonso fixtures mutate the selected definition on both sides and do not isolate role ownership. Flint archived outcome variation remains evidence even when current runtime is deterministic. Variants are simulator counterfactuals, not live-disabled skills.',
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
