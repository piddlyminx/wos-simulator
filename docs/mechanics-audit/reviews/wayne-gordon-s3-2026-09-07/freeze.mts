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
const keys = ['hero:Wayne:ThunderStrike', 'hero:Wayne:RoundaboutHit', 'hero:Wayne:Fleet', 'hero:Gordon:ToxicRelease'];
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
  sourceHashes: Object.fromEntries([...sources('simulator/src'), 'simulator/config/hero_definitions/Wayne.json', 'simulator/config/hero_definitions/Gordon.json'].map(path => [path, hash(readFileSync(resolve(root, path)))])),
  artifacts: Object.fromEntries(['config.json', 'cases.json', 'freeze.mts', 'worker.mts'].map(path => [path, hash(readFileSync(resolve(dir, path)))])),
  variants: {
    ThunderStrike: ['current', 'omit', 'marksman_only', 'normal_kind'],
    RoundaboutHit: ['current', 'omit', 'omit_lancer', 'omit_marksman', 'first_attack'],
    Fleet: ['current', 'omit', 'marksman_only', 'normal_kind'],
    ToxicRelease: ['current', 'omit', 'omit_infantry', 'omit_marksman', 'one_turn', 'all_enemy'],
  },
  definitions: {
    current: 'Complete current runtime and kit: fractional army term, inner source ceiling, Reina120% level1 and Hendrik first2.',
    omit: 'Remove only selected skill effects, preserving real hero levels and companions.',
    marksman_only: 'Restrict ThunderStrike generated-attack carriers or Fleet triggering attacks to own Marksmen.',
    normal_kind: 'Change only selected generated damage jobs from skill to normal; same multiplier, cadence, source and target.',
    omit_lancer: 'Remove only RoundaboutHit Lancer-target component.',
    omit_marksman: 'Remove only selected skill Marksman-target component.',
    first_attack: 'RoundaboutHit starts on first Marksman attack, retaining every2 thereafter.',
    omit_infantry: 'Remove only ToxicRelease Infantry vulnerability component.',
    one_turn: 'Both ToxicRelease components last1 turn instead of2.',
    all_enemy: 'Both ToxicRelease components apply to every enemy troop class instead of distinct Infantry/Marksman scopes.',
  },
  sampling: { repeat: 1000, seed: 'wayne-gordon-s3-review-2026-09-07:<fixture-key>:<run-index>', traceRuns: 16, score: 'Attacker minus defender survivors, preserving both sides in draws.', deterministic: 'One exact simulation with per-side survivors, rounds and every game record. No deterministic p-value or universal two-troop cutoff.' },
  limits: [
    'Full-kit agreement does not identify all nested components, timing, grouping, kind, levels or probabilities.',
    'Shared seed strings need not yield paired skill activations after RNG consumption changes.',
    'Active-corpus coverage only; archived evidence remains accepted and is not claimed exhaustively searched by this batch.',
    'Wayne/Gordon, Hector/Renee/Wayne and Gatot residuals remain accepted disagreements rather than exclusion criteria.',
    'The older Gordon/Wayne description contains different counts from its current structured entry. Preserve both; compare exact structured inputs and retain the conflict as an input-provenance limit.',
  ],
});
console.log(JSON.stringify({ skills: selections.length, cases: Object.keys(cases).length, outcomes: Object.values(cases).reduce((sum, row: any) => sum + (Array.isArray(row.game) ? row.game.length : 1), 0) }));
