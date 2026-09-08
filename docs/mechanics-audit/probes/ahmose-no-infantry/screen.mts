import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSimulatorConfig } from '../../../../simulator/src/config-node';
import { prepareBattle, runPrepared } from '../../../../simulator/src/simulator';

const dir = dirname(fileURLToPath(import.meta.url)), root = resolve(dir, '../../../..');
const source = resolve(root, 'testcases/emulator_verified/greg_deterrence_200i_vs_400m.json');
const greg = JSON.parse(readFileSync(source, 'utf8'))[0], config = loadSimulatorConfig(), noS1 = structuredClone(config);
noS1.heroDefinitions.Ahmose.skills.ViperFormation.effects = {};
const input = {
  attacker: { ...structuredClone(greg.defender), heroes: { Ahmose: { skill_1: 1, skill_2: 1, skill_3: 0 } }, troops: { lancer_t6: 200 } },
  defender: { ...structuredClone(greg.attacker), heroes: {}, troops: { infantry_t6: 200 } },
};
const rows = [];
for (const lancers of [160, 200, 240]) for (const infantry of [100, 125, 150, 175, 200, 250]) {
  const i = structuredClone(input); i.attacker.troops.lancer_t6 = lancers; i.defender.troops.infantry_t6 = infantry;
  const candidates: any = {};
  for (const [name, c] of Object.entries({ current: config, requires_infantry_source: noS1 })) {
    const r = runPrepared(prepareBattle(i, c), 'ahmose-no-infantry', { mode: 'fast' });
    assert(r.randomness.deterministic);
    candidates[name] = { remaining: r.remaining, winner: r.winner, rounds: r.rounds };
  }
  rows.push({ lancers, infantry, candidates });
}
const output = { exposure: 'Input-only prospective design. No battle on this formation has been captured.', sourceFixture: source, sourceSha256: createHash('sha256').update(readFileSync(source)).digest('hex'), input,
  stats: 'Used WIP Lancer and minxxx Infantry blocks are visually verified in all five Greg reports; selected Ahmose Infantry and nohero minxxx Marksman blocks are unused estimates copied from those earlier reports and require fresh verification.',
  hypotheses: 'Current fixed-turn Viper protects Lancers without Infantry. A rule requiring Infantry attacks or a living Infantry source creates no Viper effects here; model only that zero-contribution alternative.', rows };
writeFileSync(resolve(dir, 'screen.json'), JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(rows.map(r => ({ lancers: r.lancers, infantry: r.infantry, ...Object.fromEntries(Object.entries(r.candidates).map(([n, v]: any) => [n, { A: Object.values(v.remaining.attacker).reduce((s: number, x: any) => s + x, 0), D: Object.values(v.remaining.defender).reduce((s: number, x: any) => s + x, 0), rounds: v.rounds }])) })), null, 2));
