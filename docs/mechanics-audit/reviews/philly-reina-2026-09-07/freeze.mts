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
const keys = ['hero:Philly:VigorTactics', 'hero:Philly:NumbingSpores', 'hero:Reina:AssassinsInstinct', 'hero:Reina:SwiftJive'];
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
  sourceHashes: Object.fromEntries([...sources('simulator/src'), 'simulator/config/hero_definitions/Philly.json', 'simulator/config/hero_definitions/Reina.json'].map(path => [path, hash(readFileSync(resolve(root, path)))])),
  artifacts: Object.fromEntries(['config.json', 'cases.json', 'freeze.mts', 'worker.mts'].map(path => [path, hash(readFileSync(resolve(dir, path)))])),
  variants: {
    VigorTactics: ['current', 'omit', 'omit_attack', 'omit_defense', 'lancer_only'],
    NumbingSpores: ['current', 'omit', 'infantry_only', 'normal_only'],
    AssassinsInstinct: ['current', 'omit', 'lancer_only', 'all_kinds', 'hero_bucket'],
    SwiftJive: ['current', 'omit', 'enemy_infantry_only', 'own_infantry_only'],
  },
  definitions: {
    current: 'Complete current runtime and kit. Retain corrected Reina S3 magnitude and user-confirmed skill classification of both Reina S3 and Philly S2.',
    omit: 'Remove only selected skill effects, preserving real hero levels and companions.',
    omit_attack: 'Remove only VigorTactics Attack component.',
    omit_defense: 'Remove only VigorTactics Defense component.',
    lancer_only: 'Restrict selected stat or normal-damage bonuses to own Lancers.',
    infantry_only: 'Restrict NumbingSpores protection to own Infantry.',
    normal_only: 'Restrict NumbingSpores protection to incoming normal damage.',
    all_kinds: 'Allow AssassinsInstinct to affect normal and skill jobs, keeping its normal-damage bucket and value.',
    hero_bucket: 'Move AssassinsInstinct to active.hero.damage.up, retaining normal-only eligibility and magnitude.',
    enemy_infantry_only: 'SwiftJive triggers only on enemy Infantry attacks, protecting any own normal target.',
    own_infantry_only: 'SwiftJive triggers only when enemy normal attacks target own Infantry.',
  },
  sampling: { repeat: 1000, seed: 'philly-reina-review-2026-09-07:<fixture-key>:<run-index>', traceRuns: 16, score: 'Attacker minus defender survivors, preserving both sides in draws.', deterministic: 'One exact simulation with per-side survivors, rounds and every game record. No deterministic p-value or universal two-troop cutoff.' },
  limits: [
    'Full-kit agreement does not identify all nested components, timing, grouping, kind, levels or probabilities.',
    'Shared seed strings need not yield paired skill activations after RNG consumption changes.',
    'Active-corpus coverage only; archived evidence remains accepted and is not claimed exhaustively searched by this batch.',
    'The mixed six-hero discrepancy remains accepted evidence, not an exclusion criterion.',
    'Earlier Reina alternate-semantics review already rejected specific shared/reactive round-dodge replacements using six S3-locked observations. Those results remain evidence, not a new independent batch.',
  ],
});
console.log(JSON.stringify({ skills: selections.length, cases: Object.keys(cases).length, outcomes: Object.values(cases).reduce((sum, row: any) => sum + (Array.isArray(row.game) ? row.game.length : 1), 0) }));
