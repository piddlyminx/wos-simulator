import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSimulatorConfig } from '../../../../simulator/src/config-node';
import { prepareBattle, runPrepared } from '../../../../simulator/src/simulator';

const dir = dirname(fileURLToPath(import.meta.url)), root = resolve(dir, '../../../..');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const config = loadSimulatorConfig();
assert.equal(config.heroDefinitions.Hendrik.skills.DragonsHeir.trigger.first, undefined);
const paths = ['simulator/src/simulator.ts', 'simulator/src/extraAttacks.ts', 'simulator/src/damage.ts', 'simulator/src/effects.ts', 'simulator/src/damageBuckets.ts', 'simulator/config/hero_definitions/Hendrik.json', 'simulator/config/troop_skills.json'];
const hashes = Object.fromEntries(paths.map(path => [path, hash(resolve(root, path))]));
const protocol = read(join(dir, 'protocol.json'));
const full = [], summaries = [];
for (const c of protocol.cases) {
  const r = runPrepared(prepareBattle(c.input, config), 'hendrik-full-trace', { mode: 'trace' });
  assert.equal(r.randomness.deterministic, true);
  full.push({ id: c.id, input: c.input, result: r });
  const rows = r.trace!.rounds.map(round => {
    const jobs = r.attacks.filter(job => job.round === round.round);
    const incoming = jobs.filter(job => job.takerSide === c.heroSide);
    const outgoing = jobs.filter(job => job.dealerSide === c.heroSide);
    const s3 = outgoing.filter(job => job.sourceEffectId === 'DragonsHeir/1');
    return {
      round: round.round, start: round.roundStartTroops,
      incoming: incoming.map(job => ({ source: job.dealerUnit, target: job.takerUnit, kills: job.kills,
        armor: job.appliedEffects?.find(effect => effect.effectId === 'ArmorOfBarnacles/1'),
        effects: job.appliedEffects })),
      normal: outgoing.filter(job => job.kind === 'normal').map(job => ({ source: job.dealerUnit, target: job.takerUnit, kills: job.kills, effects: job.appliedEffects })),
      s3: s3.map(job => ({ target: job.takerUnit, kills: job.kills, effects: job.appliedEffects })),
      totalIncoming: incoming.reduce((sum, job) => sum + job.kills, 0),
      totalNormal: outgoing.filter(job => job.kind === 'normal').reduce((sum, job) => sum + job.kills, 0),
      totalS3: s3.reduce((sum, job) => sum + job.kills, 0),
      cancellationCount: jobs.filter(job => job.cancelReason).length
    };
  });
  summaries.push({ id: c.id, game: c.game, gameCountsS2S3: c.counts, remaining: r.remaining, rounds: r.rounds, rows });
  console.log(JSON.stringify({ id: c.id, remaining: r.remaining, rounds: r.rounds }));
  if (c.heroSide === 'attacker') {
    console.log('round  ownM  enemyI/L/M  incomingI/L/M  S2  normal  S3(I/L/M)');
    for (const row of rows) {
      const f = (n: number) => n.toFixed(3);
      console.log([row.round, f(row.start.attacker.marksman), Object.values(row.start.defender).map(f).join('/'), row.incoming.map(j => f(j.kills)).join('/'), row.incoming.map(j => j.armor ? 'Y' : '-').join(''), f(row.totalNormal), row.s3.map(j => f(j.kills)).join('/') || '-'].join('  '));
    }
  }
}
for (const [path, sha] of Object.entries(hashes)) assert.equal(hash(resolve(root, path)), sha, path);
writeFileSync(join(dir, 'full-traces.json'), JSON.stringify({ generatedAt: new Date().toISOString(), sourceHashes: hashes, config, cases: full }, null, 2) + '\n', { flag: 'wx' });
writeFileSync(join(dir, 'round-ledger.json'), JSON.stringify({ generatedAt: new Date().toISOString(), sourceHashes: hashes, cases: summaries }, null, 2) + '\n', { flag: 'wx' });
