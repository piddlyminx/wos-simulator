import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { loadSimulatorConfig } from '../../../../simulator/src/config-node';
import { adaptTestcaseEntry } from '../../../../simulator/src/tooling/testcases';

const dir = dirname(fileURLToPath(import.meta.url)), root = resolve(dir, '../../../..');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const config = loadSimulatorConfig(), inventory = read(resolve(root, 'docs/mechanics-audit/inventory.json'));
const cases = inventory.fixtures.map((fixture: any) => {
  const path = resolve(root, fixture.path), raw = read(path), entry = Array.isArray(raw) ? raw[fixture.index] : raw;
  return { key: fixture.key, input: adaptTestcaseEntry(entry), game: entry.game_report_result, sha256: hash(path) };
});
const scratch = mkdtempSync(join(tmpdir(), 'wos-trait-inheritance-'));
function patch(path: string, before: string, after: string) {
  const source = readFileSync(path, 'utf8'); assert.equal(source.split(before).length, 2, path);
  writeFileSync(path, source.replace(before, after));
}
try {
  const saved = existsSync(join(dir, 'trait-protocol.json')) ? read(join(dir, 'trait-protocol.json')) : undefined;
  if (saved) {
    assert.equal(hash(join(dir, 'trait-runtime.tar.gz')), saved.archiveSha256);
    assert.deepEqual(JSON.parse(JSON.stringify(config)), saved.config);
    assert.deepEqual(JSON.parse(JSON.stringify(cases)), saved.cases);
    mkdirSync(join(scratch, 'baseline'));
    execFileSync('tar', ['-xzf', join(dir, 'trait-runtime.tar.gz'), '-C', join(scratch, 'baseline')]);
  } else cpSync(resolve(root, 'simulator/src'), join(scratch, 'baseline'), { recursive: true });
  cpSync(join(scratch, 'baseline'), join(scratch, 'candidate'), { recursive: true });
  const sourcePaths = readdirSync(join(scratch, 'baseline'), { recursive: true }).map(String).filter(path => path.endsWith('.ts') && !path.endsWith('.test.ts'));
  const sourceHashes = Object.fromEntries(sourcePaths.map(path => [path, hash(join(scratch, 'baseline', path))]));
  if (saved) assert.deepEqual(sourceHashes, saved.sourceHashes);
  else execFileSync('tar', ['-czf', join(dir, 'trait-runtime.tar.gz'), '-C', join(scratch, 'baseline'), '.']);
  const extra = join(scratch, 'candidate/extraAttacks.ts'), damage = join(scratch, 'candidate/damage.ts');
  patch(extra, '              sourceEffectId,\n', '              sourceEffectId,\n              primaryTarget: source.side === normalAttack.dealerSide && source.unit === normalAttack.dealerUnit ? normalAttack.takerUnit : undefined,\n');
  patch(damage, '  applyBucketEffects(\n    options.effectIndex.damageGroupsByJobShape[jobSlot],', `  const primaryTarget = (job as any).primaryTarget;
  const primarySlot = primaryTarget === undefined ? jobSlot : damageJobShapeSlot(job.kind, job.dealerSide, job.dealerUnit, job.takerSide, primaryTarget);
  const traitIds = new Set(["MasterBrawler/1", "Charge/1", "RangedStrike/1"]);
  const isTrait = (group: ActiveEffectGroup) => options.effectIndex.liveEffectsByGroup[group.ordinal].some(effect => traitIds.has(effect.source.effectId ?? ""));
  const groups = primarySlot === jobSlot ? options.effectIndex.damageGroupsByJobShape[jobSlot] : [
    ...options.effectIndex.damageGroupsByJobShape[jobSlot].filter(group => !isTrait(group)),
    ...options.effectIndex.damageGroupsByJobShape[primarySlot].filter(isTrait)
  ];
  applyBucketEffects(
    groups,`);
  if (!saved) writeFileSync(join(dir, 'trait-protocol.json'), JSON.stringify({
    frozenAt: new Date().toISOString(), exposure: 'Retrospective: accepted game results and baseline full traces are known. No game input, coefficient or production file changed.',
    hypothesis: 'Generated attacks using the same source line inherit that normal attack target selection for the three native10% troop matchup traits; other modifiers and target defenses still use each actual target. Test as a general rule across the corpus, not a Hendrik-only exception.',
    motivation: 'Trace shows RangedStrike10% on the primary Infantry hit, absent from S3 backline hits. First observed backline losses are roughly10% above modeled S3 losses.10 is the existing native trait value, not a fitted coefficient.',
    beforeReplay: 'Expect increased Hendrik backline damage, lower incoming backline fire and possibly survival into the33rd turn. Require comparison of endpoint and activation counts, and inspect every other affected deterministic fixture for contrary evidence. Single-seed stochastic differences are only sensitivity diagnostics.',
    sourceHashes, archiveSha256: hash(join(dir, 'trait-runtime.tar.gz')), config, cases
  }, null, 2) + '\n', { flag: 'wx' });
  const baseline = await import(pathToFileURL(join(scratch, 'baseline/simulator.ts')).href);
  const candidate = await import(pathToFileURL(join(scratch, 'candidate/simulator.ts')).href);
  if (process.argv.includes('--followup')) {
    const prior = read(join(dir, 'trait-results.json')).results;
    const selected = cases.filter((c: any) => prior.find((row: any) => row.key === c.key).changed || c.key.includes('hendrik'));
    writeFileSync(join(dir, 'trait-followup-protocol.json'), JSON.stringify({ createdAt: new Date().toISOString(), exposure: 'Retrospective follow-up after the301-input structural screen. Trace Hendrik counts and run1000 shared-seed samples for every affected stochastic input. No changes to the frozen candidate.', selected: selected.map((c: any) => c.key), samples: 1000 }, null, 2) + '\n', { flag: 'wx' });
    const metrics = await import(pathToFileURL(join(scratch, 'baseline/tooling/parityMetrics.ts')).href);
    const summaries = [];
    for (const c of selected) {
      const deterministic = prior.find((row: any) => row.key === c.key).baseline.deterministic;
      const observed = Array.isArray(c.game) ? c.game : [c.game];
      const initial: any = Object.fromEntries(['attacker', 'defender'].map(side => [side, Object.values(c.input[side].troops).reduce((sum: number, n: any) => sum + n, 0)]));
      const variants: any = {};
      for (const [name, engine] of [['baseline', baseline], ['candidate', candidate]] as const) {
        const prepared = engine.prepareBattle(c.input, config);
        const samples: number[] = [];
        let trace: any;
        for (let i = 0; i < (deterministic ? 1 : 1000); i++) {
          const r = engine.runPrepared(prepared, `trait-followup:${c.key}:${i}`, { mode: deterministic ? 'trace' : 'fast' });
          samples.push(Object.values(r.remaining.attacker).reduce((sum: number, n: any) => sum + n, 0) - Object.values(r.remaining.defender).reduce((sum: number, n: any) => sum + n, 0));
          if (deterministic) trace = r;
        }
        const mean = samples.reduce((sum, n) => sum + n, 0) / samples.length;
        variants[name] = { samples, mean, sd: samples.length === 1 ? 0 : Math.sqrt(samples.reduce((sum, n) => sum + (n - mean) ** 2, 0) / (samples.length - 1)),
          comparison: deterministic ? null : metrics.compareOutcomeDistribution({ candidate: { samples }, reference: { samples: observed.map((o: any) => o.attacker - o.defender) }, initialTroops: initial.attacker + initial.defender, outcomeRange: { min: -initial.defender, max: initial.attacker }, deterministic: false }), trace };
      }
      summaries.push({ key: c.key, observed, deterministic, variants });
      console.log(JSON.stringify({ key: c.key, deterministic, variants: Object.fromEntries(Object.entries(variants).map(([name, v]: any) => [name, { mean: v.mean, sd: v.sd, comparison: v.comparison }])) }));
    }
    for (const [path, sha] of Object.entries(sourceHashes)) assert.equal(hash(resolve(root, 'simulator/src', path)), sha, path);
    writeFileSync(join(dir, 'trait-followup.json.gz'), gzipSync(JSON.stringify({ generatedAt: new Date().toISOString(), summaries }, null, 2) + '\n'), { flag: 'wx' });
    process.exitCode = 0;
  } else {
  const results = [];
  const sideTotal = (v: any) => Object.values(v).reduce((sum: number, n: any) => sum + n, 0);
  for (const c of cases) {
    const variants: any = {};
    for (const [name, engine] of [['baseline', baseline], ['candidate', candidate]] as const) {
      const r = engine.runPrepared(engine.prepareBattle(c.input, config), `trait:${c.key}`, { mode: 'fast' });
      const totals = { attacker: sideTotal(r.remaining.attacker), defender: sideTotal(r.remaining.defender) };
      variants[name] = { remaining: r.remaining, totals, rounds: r.rounds, winner: r.winner, skillReport: r.skillReport, deterministic: r.randomness.deterministic,
        errors: (Array.isArray(c.game) ? c.game : [c.game]).map((game: any) => Math.max(Math.abs(totals.attacker - game.attacker), Math.abs(totals.defender - game.defender))) };
    }
    const changed = JSON.stringify(variants.baseline) !== JSON.stringify(variants.candidate);
    results.push({ key: c.key, game: c.game, changed, ...variants });
    if (changed && variants.baseline.deterministic) console.log(JSON.stringify({ key: c.key, game: c.game, baseline: variants.baseline.totals, candidate: variants.candidate.totals, rounds: [variants.baseline.rounds, variants.candidate.rounds] }));
  }
  for (const [path, sha] of Object.entries(sourceHashes)) assert.equal(hash(resolve(root, 'simulator/src', path)), sha, path);
  writeFileSync(join(dir, 'trait-results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ cases: results.length, changed: results.filter(r => r.changed).length, deterministicChanged: results.filter(r => r.changed && r.baseline.deterministic).length }));
  }
} finally { rmSync(scratch, { recursive: true, force: true }); }
