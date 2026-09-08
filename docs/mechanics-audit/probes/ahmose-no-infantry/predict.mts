import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const hash = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
assert(process.argv[2] && process.argv[3], 'Usage: predict.mts INPUT_JSON NEW_OUTPUT_JSON');
const inputPath = resolve(process.argv[2]), output = resolve(process.argv[3]);
assert(!existsSync(output));
for (const [path, sha] of Object.entries(read(join(dir, 'manifest.json')))) assert.equal(hash(join(dir, path)), sha, path);
const input = read(inputPath), config = read(join(dir, 'config.json')), spec = read(join(dir, 'spec.json'));
for (const side of ['attacker', 'defender']) {
  assert.deepEqual(input[side].heroes, spec[side].heroes);
  assert.deepEqual(input[side].troops, spec[side].troops);
  assert.deepEqual(input[side].joiner_heroes ?? {}, {});
}
assert.equal(input.engagement_type, undefined); assert.equal(input.maxRounds, undefined);
const configs = { current: config, requires_infantry_source: structuredClone(config) };
configs.requires_infantry_source.heroDefinitions.Ahmose.skills.ViperFormation.effects = {};
const temp = mkdtempSync(join(tmpdir(), 'wos-ahmose-source-'));
try {
  execFileSync('tar', ['-xzf', join(dir, 'runtime.tar.gz'), '-C', temp]);
  const archive = read(join(dir, 'runtime-manifest.json'));
  assert.equal(hash(join(dir, 'runtime.tar.gz')), archive.archive_sha256);
  for (const [path, sha] of Object.entries(archive.source_files)) assert.equal(hash(join(temp, path)), sha, path);
  const engine = await import(pathToFileURL(join(temp, 'simulator.ts')).href);
  const candidates: any = {};
  for (const [name, c] of Object.entries(configs)) {
    const result = engine.runPrepared(engine.prepareBattle(input, c), 'ahmose-no-infantry', { mode: 'trace' });
    assert(result.randomness.deterministic);
    const corners = [];
    for (let mask = 0; mask < 256; mask++) {
      const i = structuredClone(input); let bit = 0;
      for (const [side, unit] of [['attacker', 'lanc'], ['defender', 'inf']]) for (const stat of ['attack', 'defense', 'lethality', 'health']) i[side].stats[unit][stat] += mask & (1 << bit++) ? .05 : -.05;
      const r = engine.runPrepared(engine.prepareBattle(i, c), 'ahmose-no-infantry', { mode: 'fast' });
      corners.push({ mask, remaining: r.remaining, score: engine.signedRemainingScore(r), rounds: r.rounds });
    }
    candidates[name] = { score: engine.signedRemainingScore(result), result, precision: { interpretation: 'All256 corners of eight used displayed stats at±0.05; sensitivity screen, not a guaranteed interior envelope.', scoreRange: [Math.min(...corners.map(r => r.score)), Math.max(...corners.map(r => r.score))], rows: corners } };
  }
  writeFileSync(output, JSON.stringify({ createdAt: new Date().toISOString(), exposure: 'Replay of supplied input; this helper makes no claim of outcome blindness. Original protocol fixes chronology.', inputPath, inputSha256: hash(inputPath), input, candidates }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(Object.fromEntries(Object.entries(candidates).map(([name, r]: any) => [name, { score: r.score, remaining: r.result.remaining, rounds: r.result.rounds, skillReport: r.result.skillReport, precisionRange: r.precision.scoreRange }])), null, 2));
} finally { rmSync(temp, { recursive: true, force: true }); }
