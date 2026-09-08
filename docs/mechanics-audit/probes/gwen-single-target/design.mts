import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSimulatorConfigFromDir } from '../../../../simulator/src/config-node.ts';
import { prepareBattle, runPrepared } from '../../../../simulator/src/simulator.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(dir, '../../../..');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const write = (name: string, value: unknown) => writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
assert(!existsSync(join(dir, 'protocol.json')), 'Preserve original design');
const config = loadSimulatorConfigFromDir(join(root, 'simulator/config'));
const input = read(join(dir, '../gwen-small-timing-550/input.json'));
const alternatives = {
  current: { first: 5, every: 4 },
  first5_every5: { first: 5, every: 5 },
  first4_every5: { first: 4, every: 5 },
  first6_every4: { first: 6, every: 4 },
  no_s3: null,
};
const configs = Object.fromEntries(Object.entries(alternatives).map(([name, cadence]) => {
  const copy = structuredClone(config), skill = copy.heroDefinitions.Gwen.skills.Blastmaster;
  if (cadence) Object.assign(skill.trigger, cadence);
  else skill.effects['Blastmaster/1'].value = [0, 0, 0, 0, 0];
  return [name, copy];
}));
const walk = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap(entry => {
  const child = join(path, entry.name);
  return entry.isDirectory() ? walk(child) : [child];
});
const runtime = join(root, 'simulator/src');
const sourceFiles = walk(runtime).filter(path => path.endsWith('.ts')).sort();
const sourceHashes = Object.fromEntries(sourceFiles.map(path => [relative(runtime, path), hash(readFileSync(path))]));
execFileSync('tar', ['-czf', join(dir, 'runtime.tar.gz'), '-C', runtime, ...Object.keys(sourceHashes)]);
write('runtime-manifest.json', { source_files: sourceHashes, archive_sha256: hash(readFileSync(join(dir, 'runtime.tar.gz'))) });
write('config-snapshot.json', config);
write('source-input.json', input);
write('alternatives.json', alternatives);
write('protocol.json', {
  createdAt: new Date().toISOString(),
  exposure: 'All three prior mixed-target Gwen captures and all older accepted Gwen outcomes were known. No game outcome for any formation in this new single-target count screen has been collected or read.',
  purpose: 'Discriminate S3 cadence with one enemy troop line, so sibling fanout consumption and backline depletion cannot affect interpretation. Retain full Gwen 3/1/1 and all current S1/S2 effects.',
  hypotheses: alternatives,
  directionalPrediction: 'Less frequent S3 attacks should usually reduce Gwen damage and survivor advantage; feedback and S1/S2 charge consumption mean exact direction and separation must be simulated.',
  countScreen: { marksman_t6: [150, 250, 350, 450, 550], infantry_t6: [300, 500, 700, 900] },
  selection: 'Prefer sub-1000 armies, several S3 opportunities, and endpoint differences substantially larger than 1-2 survivors plus displayed-stat uncertainty. Do not select a coefficient or production fix from this screen.',
  stats: 'Exact report-resolved blocks from prior verified Gwen battle. Conditional on unchanged fresh stats; no generation bonus added. Verify fresh report and replay changes using these frozen models.',
  interpretation: 'A matching endpoint constrains cadence only under retained S1/S2 lifecycle and damage assumptions. It does not establish a universal cadence or resolve prior mixed-target contradictions.',
  source_input_sha256: hash(readFileSync(join(dir, 'source-input.json'))),
  config_sha256: hash(readFileSync(join(dir, 'config-snapshot.json'))),
  script_sha256: hash(readFileSync(fileURLToPath(import.meta.url))),
});
const rows = [];
for (const marksmen of [150, 250, 350, 450, 550]) for (const infantry of [300, 500, 700, 900]) {
  const battle = structuredClone(input);
  battle.attacker.troops = { marksman_t6: marksmen };
  battle.defender.troops = { infantry_t6: infantry };
  const results: Record<string, unknown> = {};
  for (const [name, candidate] of Object.entries(configs)) {
    const result = runPrepared(prepareBattle(battle, candidate), 'gwen-single-target-design', { mode: 'fast' });
    assert(result.randomness.deterministic);
    const total = (side: 'attacker' | 'defender') => Object.values(result.remaining[side]).reduce((a, b) => a + b, 0);
    results[name] = { score: total('attacker') - total('defender'), rounds: result.rounds, winner: result.winner, remaining: result.remaining };
  }
  rows.push({ marksmen, infantry, results });
}
for (const [path, expected] of Object.entries(sourceHashes)) assert.equal(hash(readFileSync(join(runtime, path))), expected);
write('screen.json', { createdAt: new Date().toISOString(), protocol_sha256: hash(readFileSync(join(dir, 'protocol.json'))), rows });
console.log(JSON.stringify(rows.map(row => ({ marksmen: row.marksmen, infantry: row.infantry, ...Object.fromEntries(Object.entries(row.results).map(([name, result]: any) => [name, [result.score, result.rounds]])) })), null, 2));
