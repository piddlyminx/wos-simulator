import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSimulatorConfig } from '../../../../simulator/src/config-node';
import { adaptTestcaseEntry } from '../../../../simulator/src/tooling/testcases';

const dir = dirname(fileURLToPath(import.meta.url)), root = resolve(dir, '../../../..');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const write = (name: string, value: unknown) => writeFileSync(resolve(dir, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const inventory = JSON.parse(readFileSync(resolve(root, 'docs/mechanics-audit/inventory.json'), 'utf8'));
const keys = ['hero:Lynn:SongOfLion','hero:Lynn:MelancholicBallad','hero:Lynn:OonaiCadenza','hero:Norah:CombinedArms','hero:Norah:SneakStrike','hero:Norah:Momentum','hero:Molly:YouthfulRage','hero:Natalia:WildlingRoar','hero:Natalia:QueenOfTheWild'];
const selections = keys.map(key => {
  const row = inventory.definitions.find((d: any) => d.key === key);
  assert(row && row.review_status === 'unreviewed');
  return { key, hero: row.owner, id: row.id, slot: row.slot, coverage: row.coverage, definition: row.definition };
});
const cases = Object.fromEntries([...new Set(selections.flatMap(s => s.coverage.fixture_keys))].map((key: any) => {
  const fixture = inventory.fixtures.find((row: any) => row.key === key);
  assert.equal(fixture.provenance.game_evidence_status, 'accepted_game_evidence');
  const text = readFileSync(resolve(root, fixture.path), 'utf8'), rows = JSON.parse(text);
  const entry = Array.isArray(rows) ? rows[fixture.index] : rows;
  assert.equal(hash(text), fixture.source_sha256, 'Refresh inventory before freezing changed inputs');
  return [key, { key, path: fixture.path, fixtureSha256: hash(text), entry, input: adaptTestcaseEntry(entry), game: entry.game_report_result, hydratedSkills: fixture.hydrated_skills }];
}));
const sources = (path: string): string[] => readdirSync(resolve(root, path), { withFileTypes: true }).flatMap(entry => entry.isDirectory()
  ? sources(`${path}/${entry.name}`) : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [`${path}/${entry.name}`] : []);
write('config.json', loadSimulatorConfig());
write('cases.json', cases);
write('protocol.json', {
  writtenAt: new Date().toISOString(),
  phase: 'Retrospective accepted-corpus structural review. Current definitions, earlier reviews and known disagreements were read before choosing these bounded alternatives. No live action, input adjustment or coefficient fit.',
  selections,
  sourceHashes: Object.fromEntries([...sources('simulator/src'), 'simulator/config/hero_definitions/Lynn.json','simulator/config/hero_definitions/Norah.json','simulator/config/hero_definitions/Molly.json','simulator/config/hero_definitions/Natalia.json'].map(path => [path, hash(readFileSync(resolve(root, path)))])),
  artifacts: Object.fromEntries(['config.json', 'cases.json', 'freeze.mts', 'worker.mts'].map(path => [path, hash(readFileSync(resolve(dir, path)))])),
  variants: {
    SongOfLion: ['current','omit','marksman_only','hero_damage_bucket'],
    MelancholicBallad: ['current','omit','enemy_infantry_only','normal_only'],
    OonaiCadenza: ['current','omit','max_stack','all_own'],
    CombinedArms: ['current','omit','omit_offense','omit_protection','infantry_only','all_own'],
    SneakStrike: ['current','omit','primary_target_only','normal_kind','all_sources'],
    Momentum: ['current','omit','omit_offense','omit_protection','immediate','one_turn','all_enemy'],
    YouthfulRage: ['current','omit','marksman_only','hero_damage_bucket'],
    WildlingRoar: ['current','omit','infantry_only','normal_only'],
    QueenOfTheWild: ['current','omit','infantry_only','hero_damage_bucket'],
  },
  definitions: {
    current:'Complete current runtime and full real kits, with already adopted arithmetic, Reina and Hendrik changes.',
    omit:'Remove only selected skill effects, retain levels and companion skills.',
    marksman_only:'Restrict selected offensive effect recipients to own Marksmen.',
    infantry_only:'Restrict selected own protection/offense recipients to Infantry.',
    enemy_infantry_only:'Restrict MelancholicBallad to enemy Infantry damage sources.',
    normal_only:'Restrict selected defensive effect to incoming normal damage.',
    hero_damage_bucket:'Move selected offensive effect to active.hero.damage.up, retain scope/value/trigger.',
    max_stack:'Replace cumulative OonaiCadenza stacking with maximum value only.',
    all_own:'Expand OonaiCadenza or CombinedArms recipients to all own troop classes, preserve trigger source.',
    omit_offense:'Remove only selected offensive component.',
    omit_protection:'Remove only selected damage-taken protection component.',
    primary_target_only:'SneakStrike hits only its source normal attack target instead of fanout.',
    normal_kind:'SneakStrike generated jobs use normal kind, keep exact coefficient/schedule/targets.',
    all_sources:'SneakStrike may trigger from any own troop source instead of Lancers only.',
    immediate:'Momentum components start on trigger turn rather than next turn.',
    one_turn:'Momentum components last1 turn instead of2, preserve next-turn delay.',
    all_enemy:'Momentum offense applies against all enemy lines instead of locked trigger target.',
  },
  sampling: { repeat: 1000, seed: 'remaining-ordinary-review-2026-09-07:<fixture-key>:<run-index>', traceRuns: 16, score: 'Attacker minus defender survivors, preserving both sides in draws.', deterministic: 'One exact simulation with per-side survivors, rounds and every game record. No deterministic p-value or universal two-troop cutoff.' },
  limits: [
    'Full-kit agreement does not identify all nested components, timing, grouping, kind, levels or probabilities.',
    'Shared seed strings need not yield paired skill activations after RNG consumption changes.',
    'Active-corpus coverage only; archived evidence remains accepted and is not claimed exhaustively searched by this batch.',
    'The mixed six-hero discrepancy remains accepted evidence, not an exclusion criterion.',
    'Current Norah Momentum delay is included; historical code-test timing repairs are not themselves new game evidence. Each omission/scope contrast remains conditional on the other complete skills.',
  ],
});
console.log(JSON.stringify({ skills: selections.length, cases: Object.keys(cases).length, outcomes: Object.values(cases).reduce((sum, row: any) => sum + (Array.isArray(row.game) ? row.game.length : 1), 0) }));
