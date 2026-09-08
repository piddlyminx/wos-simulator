import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSimulatorConfig } from '../../../../simulator/src/config-node';
import { prepareBattle, runPrepared, signedRemainingScore } from '../../../../simulator/src/simulator';
import { adaptTestcaseEntry } from '../../../../simulator/src/tooling/testcases';

const dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(dir, '../../../..');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const outputPath = resolve(dir, process.argv[2] ?? 'replay.json');
if (existsSync(outputPath)) throw Error('Preserve existing results; select an unused output path.');
const inventory = read('docs/mechanics-audit/inventory.json');
const base = loadSimulatorConfig();
const configText = JSON.stringify(base, null, 2) + '\n';
const snapshotPath = resolve(dir, 'config-snapshot.json');
if (existsSync(snapshotPath)) {
  if (readFileSync(snapshotPath, 'utf8') !== configText) throw Error('Frozen config differs from current production.');
} else writeFileSync(snapshotPath, configText, { flag: 'wx' });

const selected = [
  { key: 'hero:Bradley:VeteransMight' },
  { key: 'hero:Bradley:PowerShot' },
  { key: 'hero:Bradley:TacticalAssistance' },
  { key: 'hero:Edith:StrategicBalance' },
  { key: 'hero:Edith:SteelSentinel' },
];
function sourcePaths(path: string): string[] {
  return readdirSync(resolve(root, path), { withFileTypes: true }).flatMap(entry => {
    const child = `${path}/${entry.name}`;
    return entry.isDirectory() ? sourcePaths(child) : /\.ts$/.test(child) && !/\.test\.ts$/.test(child) ? [child] : [];
  });
}
const sourceHashes = Object.fromEntries(sourcePaths('simulator/src').concat(selected.map(selection =>
  inventory.definitions.find((row: any) => row.key === selection.key).source
)).map(path => [path, hash(readFileSync(resolve(root, path)))]));
const previousPath = resolve(dir, 'replay.json');
if (existsSync(previousPath)) {
  const previous = JSON.parse(readFileSync(previousPath, 'utf8'));
  for (const [path, expected] of Object.entries(previous.sourceHashes)) {
    if (sourceHashes[path] !== expected) throw Error(`Frozen runtime changed: ${path}`);
  }
}

function prediction(input: any, config: any, effectIds: string[]) {
  const result = runPrepared(prepareBattle(input, config), 'bradley-edith-review-2026-09-07', { mode: 'trace' });
  const applications: Record<string, number> = {};
  for (const job of result.attacks) for (const effect of job.appliedEffects ?? []) {
    if (!effectIds.includes(effect.effectId)) continue;
    const key = `${effect.effectId}:${job.kind}:${job.dealerSide}.${job.dealerUnit}->${job.takerSide}.${job.takerUnit}`;
    applications[key] = (applications[key] ?? 0) + 1;
  }
  return { score: signedRemainingScore(result), remaining: result.remaining, rounds: result.rounds,
    deterministic: result.randomness.deterministic, appliedEffectJobCounts: applications,
    skillReport: Object.fromEntries(Object.entries(result.skillReport).map(([side, rows]) => [side,
      rows.filter(row => effectIds.some(id => id.startsWith(`${row.skillId}/`)))])) };
}

const results = selected.map(selection => {
  const definition = inventory.definitions.find((row: any) => row.key === selection.key);
  if (definition.review_status !== 'unreviewed' && !existsSync(previousPath)) throw Error(`Skill already reviewed: ${selection.key}`);
  const configHeroId = basename(definition.source, '.json');
  const currentSkill = base.heroDefinitions[configHeroId].skills[definition.id];
  const effectIds = Object.keys(currentSkill.effects);
  const patches: { id: string; description: string; change: (skill: any) => void }[] = [];
  const add = (id: string, description: string, change: (skill: any) => void) => patches.push({ id, description, change });
  add('omit', 'Remove only the selected skill effects in the simulator; preserve the full recorded kit.', skill => { skill.effects = {}; });
  add('hero_class_only', `Restrict all selected effects to own ${definition.troop_type}; keep target restrictions.`, skill => {
    for (const effect of Object.values(skill.effects) as any[]) effect.units = { ...effect.units, applies_to: definition.troop_type };
  });
  if (effectIds.length > 1) for (const id of effectIds) {
    add(`omit_${id}`, `Remove only ${id}, preserving its sibling effect.`, skill => { delete skill.effects[id]; });
  }
  const buckets = (types: string[]) => types.forEach(type => add(`bucket_${type}`, `Keep all values/scopes but place selected effect(s) in ${type}.`, skill => {
    for (const effect of Object.values(skill.effects) as any[]) effect.type = type;
  }));
  if (definition.id === 'VeteransMight') buckets(['active.hero.damage.up', 'active.hero.lethality.up']);
  if (definition.id === 'PowerShot') {
    buckets(['active.hero.damage.up', 'type.normal.damage.up']);
    for (const id of effectIds) add(`all_enemy_types_${id}`, `Broaden only ${id} recipient enemy types to any.`, skill => {
      skill.effects[id].units.applies_vs = 'any';
    });
    add('normal_kind_only', 'Keep the single-target bucket but require normal damage kind for both effects.', skill => {
      for (const effect of Object.values(skill.effects) as any[]) effect.applies_to_damage_kinds = ['normal'];
    });
  }
  if (definition.id === 'TacticalAssistance') {
    buckets(['active.hero.attack.up', 'type.normal.damage.up']);
    add('first_round_one', 'First turn1, then every4; preserve two-turn duration.', skill => { skill.trigger.first = 1; });
    add('delay_one', 'Keep every4 scheduling but delay each two-turn window by one turn.', skill => { skill.effects[effectIds[0]].duration.turns.delay = 1; });
    add('duration_one', 'Keep first/every4 trigger but make each window last one turn.', skill => { skill.effects[effectIds[0]].duration.turns.count = 1; });
  }
  if (definition.id === 'StrategicBalance') {
    for (const id of effectIds) add(`all_own_types_${id}`, `Broaden only ${id} recipients to all own types.`, skill => {
      skill.effects[id].units.applies_to = 'all';
    });
    add('protection_health_pool', 'Move only Marksman protection from damageTaken to Health; preserve scope/value.', skill => { skill.effects['StrategicBalance/1'].type = 'active.hero.health.up'; });
    add('lancer_attack_pool', 'Move only Lancer offense from Damage to Attack; preserve scope/value.', skill => { skill.effects['StrategicBalance/2'].type = 'active.hero.attack.up'; });
  }
  if (definition.id === 'SteelSentinel') buckets(['active.hero.damageTaken.down', 'active.hero.defense.up']);
  const configs = Object.fromEntries(patches.map(patch => {
    const config = structuredClone(base); patch.change(config.heroDefinitions[configHeroId].skills[definition.id]); return [patch.id, config];
  }));
  const skipped: any[] = [];
  const fixtures = definition.coverage.fixture_keys.map((key: string) => {
    const indexed = inventory.fixtures.find((row: any) => row.key === key);
    if (!indexed || indexed.provenance.game_evidence_status !== 'accepted_game_evidence') throw Error(`Unaccepted fixture: ${key}`);
    const text = readFileSync(resolve(root, indexed.path), 'utf8');
    if (hash(text) !== indexed.source_sha256) throw Error(`Fixture changed since inventory: ${key}`);
    const rows = JSON.parse(text);
    const fixture = Array.isArray(rows) ? rows[indexed.index] : rows;
    const input = adaptTestcaseEntry(fixture);
    const current = prediction(input, base, effectIds);
    if (!current.deterministic) { skipped.push({ key, reason: 'Full-kit runtime is stochastic; this bounded review does not use a single sample as agreement evidence.' }); return null; }
    const predictions = { current, ...Object.fromEntries(Object.entries(configs).map(([name, config]) => {
      const value = prediction(input, config, effectIds);
      if (!value.deterministic) throw Error(`Diagnostic unexpectedly stochastic: ${key} ${name}`);
      return [name, value];
    })) };
    const outcomes = Array.isArray(fixture.game_report_result) ? fixture.game_report_result : [fixture.game_report_result];
    const gameScores = outcomes.map((outcome: any) => {
      if (!Number.isFinite(outcome?.attacker) || !Number.isFinite(outcome?.defender)) throw Error(`Unsupported game result: ${key}`);
      return outcome.attacker - outcome.defender;
    });
    return { key, testId: fixture.test_id, fixtureSha256: hash(text), input, inputSha256: hash(JSON.stringify(input)),
      acceptedGameOutcomes: outcomes, gameScores,
      configuredSkillInstances: indexed.hydrated_skills.filter((row: any) => row.key === selection.key),
      predictions, signedResiduals: Object.fromEntries(Object.entries(predictions).map(([name, value]) => [name, gameScores.map((score: number) => value.score - score)])) };
  }).filter(Boolean);
  return { key: selection.key, definitionSource: definition.source, definitionSha256: definition.source_sha256,
    definition: currentSkill, variants: Object.fromEntries(patches.map(({ id, description }) => [id, description])), fixtures, skipped };
});
for (const [path, expected] of Object.entries(sourceHashes)) {
  if (hash(readFileSync(resolve(root, path))) !== expected) throw Error(`Source changed during run: ${path}`);
}
if (JSON.stringify(loadSimulatorConfig(), null, 2) + '\n' !== configText) throw Error('Config changed during run.');
const output = { generatedAt: new Date().toISOString(), phase: 'retrospective_existing_accepted_game_evidence_review',
  exposure: 'Existing corpus outcomes were available before review. All counterfactuals are post hoc simulator diagnostics, not new game observations or live-disabled skills.',
  contract: 'Preserve exact recorded full kits, troop tiers, stats, engagement type and round limits. No fitted stats or magnitude tuning. Only deterministic full-kit cases reviewed; stochastic fixtures explicitly listed as skipped. Repeated fixture entries or stored copies are not automatically independent observations.',
  inventorySha256: hash(readFileSync(resolve(root, 'docs/mechanics-audit/inventory.json'))), sourceHashes,
  configSha256: hash(configText), results };
writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(results.map(row => ({ key: row.key, deterministicFixtures: row.fixtures.length, skipped: row.skipped.length,
  fixtures: row.fixtures.map((fixture: any) => ({ key: fixture.key, game: fixture.gameScores,
    predictions: Object.fromEntries(Object.entries(fixture.predictions).map(([name, value]: [string, any]) => [name, value.score])) })) })), null, 2));
