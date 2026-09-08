import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBattle, runPrepared } from '../../../../simulator/src/simulator';
import { adaptTestcaseEntry } from '../../../../simulator/src/tooling/testcases';

const dir = dirname(fileURLToPath(import.meta.url)), root = resolve(dir, '../../../..');
const read = (p: string) => JSON.parse(readFileSync(resolve(dir, p), 'utf8'));
const hash = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const original = read('protocol.json'), config = read('config.json'), cases = read('cases.json');
function guard() {
  for (const [path, sha] of Object.entries(original.sourceHashes)) assert.equal(hash(resolve(root, path)), sha, path);
  for (const [path, sha] of Object.entries(original.artifacts)) assert.equal(hash(resolve(dir, path)), sha, path);
}
guard();
const soloPath = 'testcases/emulator_verified/ahmose_solo_nc.json';
const soloEntry = JSON.parse(readFileSync(resolve(root, soloPath), 'utf8'))[0];
cases.solo = { key: `${soloPath}#0`, input: adaptTestcaseEntry(soloEntry), game: soloEntry.game_report_result };
const protocolPath = resolve(dir, 'viper-cadence-protocol.json'), output = resolve(dir, 'viper-cadence-results.json');
assert(!existsSync(protocolPath) && !existsSync(output));
const protocol = {
  createdAt: new Date().toISOString(),
  exposure: 'Retrospective. All four accepted outcomes and the earlier source-death traces were known before this comparison. No new live battle, input adjustment or coefficient fitting.',
  motivation: 'Fresh Ahmose tooltip says pauses once every four times; user describes normal-only proc counters, fixed turn schedules and effect-use counters as current community understanding with reported deterministic improvements.',
  hypotheses: {
    current: 'Existing battle turns4,8,12,..., including after Infantry die.',
    after_three_normals: 'After each third completed Infantry normal attack, schedule the pause and both protective components for the following turn. Protection keeps its2-turn duration. In an uninterrupted living line this means3 attacks then1 pause, matching every fourth opportunity; after line death no new cycles can be initiated.',
    after_four_normals: 'Literal every4 completed Infantry normal attacks, then pause/protect from the following turn. This gives4 attacks then1 pause and shifts cadence even without other interruptions.',
  },
  predictionsBeforeVariantOutput: [
    'After-three-normal should preserve the uninterrupted3-attack/1-pause trajectory while Infantry remain. It should keep the clean opposite-side case close if there are no other missed Infantry attacks.',
    'If continuing Viper protection after Infantry death explains the strong archived surplus damage, after-three-normal should reduce that protection and increase the surviving nohero attacker toward2810; the weaker case should show less change.',
    'After-four-normal changes pause/protection cadence across the whole battle and may violate the clean counterpart. Better fit to one outcome cannot establish it.',
  ],
  constraints: ['All recorded full kits/stats/troop keys unchanged.', 'No production edit or generic source-alive gate.', 'Scheduled effects created before death retain their declared duration.', 'No actual game round count is inferred from a simulator trace.'],
  hashes: { originalProtocol: hash(resolve(dir, 'protocol.json')), script: hash(fileURLToPath(import.meta.url)), soloFixture: hash(resolve(root, soloPath)), tooltip: hash(resolve(root, 'docs/mechanics-audit/hero-tooltips/WIP-ahmose-2026-09-07/tooltips.json')) },
  cases,
};
writeFileSync(protocolPath, JSON.stringify(protocol, null, 2) + '\n', { flag: 'wx' });
const configs = Object.fromEntries(Object.keys(protocol.hypotheses).map(name => {
  const c = structuredClone(config), skill = c.heroDefinitions.Ahmose.skills.ViperFormation;
  if (name !== 'current') {
    skill.trigger = { type: 'attack', source: 'infantry', every: name === 'after_three_normals' ? 3 : 4 };
    for (const effect of Object.values(skill.effects) as any[]) effect.duration.turns.delay = 1;
  }
  return [name, c];
}));
const results = [];
for (const [label, test] of Object.entries(cases) as any[]) {
  const candidates: any = {};
  for (const [name, c] of Object.entries(configs)) {
    const result = runPrepared(prepareBattle(test.input, c as any), `viper-cadence:${label}`, { mode: 'trace' });
    assert(result.randomness.deterministic, `Unexpected chance skill: ${label}/${name}`);
    const totals = Object.fromEntries(Object.entries(result.remaining).map(([side, troops]) => [side, Object.values(troops).reduce((s, n) => s + n, 0)]));
    candidates[name] = { totals, result };
    console.log(JSON.stringify({ label, candidate: name, totals, winner: result.winner, rounds: result.rounds }));
  }
  results.push({ label, key: test.key, game: test.game, candidates });
}
guard();
writeFileSync(output, JSON.stringify({ protocolSha256: hash(protocolPath), results }, null, 2) + '\n', { flag: 'wx' });
