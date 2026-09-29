import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSimulatorConfig } from '../../../../simulator/src/config-node.ts';
import { prepareBattle, runPrepared, signedRemainingScore } from '../../../../simulator/src/simulator.ts';
import { adaptTestcaseEntry } from '../../../../simulator/src/tooling/testcases.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(dir, '../../../..');
const read = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const base = loadSimulatorConfig();
const snapshot = JSON.stringify(base, null, 2) + '\n';
const configPath = resolve(dir, 'config-snapshot.json');
if (existsSync(configPath)) {
  if (readFileSync(configPath, 'utf8') !== snapshot) throw Error('Production config changed since the experiment snapshot.');
} else writeFileSync(configPath, snapshot, { flag: 'wx' });
const sourcePaths = ['config', 'damage', 'damageBuckets', 'effectIndex', 'effects', 'extraAttacks', 'fighterResolution', 'normalize', 'prepare', 'recorder', 'runtime', 'runtimeSkills', 'simulator', 'staticDamageProfile', 'troopStats', 'types'].map(name => `simulator/src/${name}.ts`);
sourcePaths.push('simulator/src/tooling/testcases.ts');
const sourceHashes = Object.fromEntries(sourcePaths.map(path => [path, createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')]));
const sourcePath = resolve(dir, 'source-hashes.json');
if (existsSync(sourcePath)) {
  if (JSON.stringify(read(sourcePath)) !== JSON.stringify(sourceHashes)) throw Error('Production runtime changed since the experiment snapshot.');
} else writeFileSync(sourcePath, JSON.stringify(sourceHashes, null, 2) + '\n', { flag: 'wx' });
const effects = {
  Ling: ['FearsomeAura', 'FearsomeAura/1'],
  Lumak: ['TacticalDeception', 'TacticalDeception/1'],
  Jessie: ['Bulwarks', 'Bulwarks/1'],
};
const configs = {};
for (const [hero, [skillId, effectId]] of Object.entries(effects)) {
  configs[hero] = {};
  for (const pool of ['attack', 'damage', 'damageTaken']) {
    const copy = structuredClone(base);
    const effect = copy.heroDefinitions[hero].skills[skillId].effects[effectId];
    effect.type = `active.hero.${pool}.down`;
    effect.units = { applies_to: pool === 'damageTaken' ? 'any' : 'enemy.any' };
    configs[hero][pool] = copy;
  }
}
function prediction(input, config, trace = false) {
  const result = runPrepared(prepareBattle(input, config), 'skill-buckets-20260928', { mode: trace ? 'trace' : 'fast' });
  if (!result.randomness.deterministic) throw Error('This experiment requires an applicable deterministic full kit.');
  return {
    score: signedRemainingScore(result), remaining: result.remaining, rounds: result.rounds,
    deterministic: result.randomness.deterministic,
    ...(trace ? { firstRound: result.attacks.filter(attack => attack.round === 1), skillReport: result.skillReport } : {}),
  };
}
const paths = process.argv.slice(2);
if (paths.length === 0) throw Error('Supply testcase paths; RESULT_NAME selects a new analysis filename.');
const rows = paths.flatMap(path => {
  const entries = read(path);
  if (!Array.isArray(entries)) throw Error(`Expected testcase array: ${path}`);
  return entries.map((entry, index) => {
    const input = adaptTestcaseEntry(entry);
    const game = entry.game_report_result;
    if (!Array.isArray(game) || !game.every(row => Number.isFinite(row.attacker) && Number.isFinite(row.defender))) throw Error(`Invalid observed outcomes: ${path}`);
    const heroes = Object.keys(effects).filter(hero => [input.attacker, input.defender].some(fighter => Object.keys(fighter.heroes ?? {}).some(name => name === base.heroDefinitions[hero].name || base.heroDefinitions[hero].aliases?.includes(name))));
    const alternatives = Object.fromEntries(heroes.map(hero => [hero, Object.fromEntries(Object.entries(configs[hero]).map(([pool, config]) => [pool, prediction(input, config)]))]));
    return { path: relative(root, resolve(root, path)), index, input, game, current: prediction(input, base, true), alternatives };
  });
});
const outputPath = resolve(dir, `${process.env.RESULT_NAME ?? 'live-analysis'}.json`);
if (existsSync(outputPath)) throw Error(`Preserve prior evidence: ${outputPath} already exists.`);
writeFileSync(outputPath, JSON.stringify({ createdAt: new Date().toISOString(), kind: 'simulator_hypotheses_compared_with_unmodified_game_reports', sourceHashes, rows }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(rows.map(row => ({ path: row.path, game: row.game.map(game => game.attacker - game.defender), current: row.current.score, alternatives: Object.fromEntries(Object.entries(row.alternatives).map(([hero, pools]) => [hero, Object.fromEntries(Object.entries(pools).map(([pool, prediction]) => [pool, prediction.score]))])) })), null, 2));
