import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url)), root = resolve(dir, '../../../..');
const frozen = resolve(root, 'docs/mechanics-audit/probes/hendrik-small-timing');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const manifest = read(join(frozen, 'manifest.json'));
assert.equal(hash(join(frozen, 'runtime.tar.gz')), manifest.archive_sha256);
const base = read(join(frozen, 'variants.json')).current;
assert.equal(base.heroDefinitions.Hendrik.skills.DragonsHeir.trigger.first, undefined);
const variants = {
  first3: 'Frozen ordinary3/6/9 schedule and current-round source strength.',
  first2: 'Historical adopted2/5/8 schedule; unchanged source strength and other skills.',
  first3_previous_source: 'Only S3 uses the previous round-start Marksman count, with inner ceiling retained. Candidate represents troop strength committed one turn before delivery; constant offensive modifiers in these probes make a full modifier snapshot unnecessary here. No coefficient change.',
  first3_before_normal: 'Resolve generated skill jobs before their accompanying normal attack, retaining round-start source strength, every3 schedule, and all coefficients.'
};
const cases = [
  { id: 'lancer', folder: 'hendrik-armor', heroSide: 'defender', game: [0, 17], counts: [13, null] },
  { id: 'marksman471', folder: 'hendrik-dragons-heir', heroSide: 'attacker', game: [0, 471], counts: [5, 6] },
  { id: 'marksman68', folder: 'hendrik-small-timing', heroSide: 'attacker', game: [0, 68], counts: [8, 11] }
].map(c => {
  const path = resolve(root, `docs/mechanics-audit/probes/${c.folder}/captured-input.json`);
  return { ...c, input: read(path), inputSha256: hash(path) };
});
writeFileSync(join(dir, 'protocol.json'), JSON.stringify({
  frozenAt: new Date().toISOString(),
  exposure: 'Retrospective: all game endpoints and counts known. No new live capture, parameter sweep, input fit or production change.',
  predictionsBeforeReplay: 'Previous source strength should increase S3 damage with six scheduled activations in the471 case. Before-normal ordering should be unchanged if constant modifiers and surviving targets make order irrelevant. Neither necessarily supplies the extra game activation in the68 case; a longer battle is a separate unresolved possibility.',
  sourceArchiveSha256: manifest.archive_sha256, variants, cases,
  jointCountConstraint: 'With ordinary complete reporting, S2 first4/e4 count5 requires turns20..23. S3 count6 requires18..20 for first3,17..19 for first2. Only first3 intersects. Counts8/11 in the small case allow33..35 for first3,32..34 for first2. These are conditional constraints, not observed rounds.',
  currentProductionHendrik: read(resolve(root, 'simulator/config/hero_definitions/Hendrik.json')),
  currentProductionHendrikSha256: hash(resolve(root, 'simulator/config/hero_definitions/Hendrik.json'))
}, null, 2) + '\n', { flag: 'wx' });

function patch(path: string, before: string, after: string) {
  const source = readFileSync(path, 'utf8'); assert.equal(source.split(before).length, 2, path + ': unambiguous patch');
  writeFileSync(path, source.replace(before, after));
}
const scratch = mkdtempSync(join(tmpdir(), 'wos-hendrik-count-consistency-'));
try {
  const results: any[] = [];
  for (const variant of Object.keys(variants)) {
    const engineDir = join(scratch, variant); mkdirSync(engineDir);
    execFileSync('tar', ['-xzf', join(frozen, 'runtime.tar.gz'), '-C', engineDir]);
    for (const [path, sha] of Object.entries(manifest.files)) assert.equal(hash(join(engineDir, path)), sha, path);
    const simulator = join(engineDir, 'simulator.ts'), extra = join(engineDir, 'extraAttacks.ts'), damage = join(engineDir, 'damage.ts');
    if (variant === 'first3_previous_source') {
      patch(simulator, '  let rounds = 0;\n', '  let previousRoundStartTroops: any;\n  let rounds = 0;\n');
      patch(simulator, '    const roundStartTroops = snapshotTroops(runtime.troops);', '    const roundStartTroops = snapshotTroops(runtime.troops);\n    (runtime as any).hendrikPreparedTroops = previousRoundStartTroops ?? roundStartTroops;\n    previousRoundStartTroops = roundStartTroops;');
      patch(extra, '              sourceMultiplier: multiplier\n', '              sourceMultiplier: multiplier,\n              ...(sourceEffectId === "DragonsHeir/1" ? { hendrikSourceTroops: (runtime as any).hendrikPreparedTroops[source.side][source.unit] } : {})\n');
      patch(damage, 'Math.max(0, job.roundStartTroops[job.dealerSide][job.dealerUnit] ?? 0)', 'Math.max(0, (job as any).hendrikSourceTroops ?? job.roundStartTroops[job.dealerSide][job.dealerUnit] ?? 0)');
    }
    if (variant === 'first3_before_normal') {
      const call = '        const extraAttacks = processExtraAttacks(job, intent, runtime, fighters, damageJobOptions, roundTargetDamage, loopOptions, results);\n';
      patch(simulator, call, '');
      patch(simulator, '        let normalKills = 0;', call + '        let normalKills = 0;');
    }
    const engine = await import(pathToFileURL(simulator).href);
    const config = structuredClone(base);
    if (variant === 'first2') config.heroDefinitions.Hendrik.skills.DragonsHeir.trigger.first = 2;
    for (const c of cases) {
      const result = engine.runPrepared(engine.prepareBattle(c.input, config), 'hendrik-count-consistency', { mode: 'trace' });
      assert.equal(result.randomness.deterministic, true);
      const jobs = result.attacks.filter((job: any) => job.sourceEffectId === 'DragonsHeir/1');
      const row = {
        id: c.id, variant, game: c.game, gameCountsS2S3: c.counts,
        remaining: result.remaining, rounds: result.rounds,
        skillReport: result.skillReport[c.heroSide],
        skillRounds: [...new Set(jobs.map((job: any) => job.round))],
        s3RawKills: jobs.reduce((sum: number, job: any) => sum + job.kills, 0),
        jobs: jobs.map((job: any) => ({ round: job.round, target: job.takerUnit, kills: job.kills, trace: job.trace })),
        sourceHashes: Object.fromEntries(['simulator.ts', 'extraAttacks.ts', 'damage.ts'].map(path => [path, hash(join(engineDir, path))]))
      };
      results.push(row);
      console.log(JSON.stringify({ id: c.id, variant, remaining: row.remaining.defender, rounds: row.rounds, s3Rounds: row.skillRounds, s3RawKills: row.s3RawKills }));
    }
  }
  writeFileSync(join(dir, 'results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2) + '\n', { flag: 'wx' });
} finally { rmSync(scratch, { recursive: true, force: true }); }
