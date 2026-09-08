import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadSimulatorConfig } from '../../../../simulator/src/config-node';
import { prepareBattle, runPrepared, signedRemainingScore } from '../../../../simulator/src/simulator';
import { adaptTestcaseEntry } from '../../../../simulator/src/tooling/testcases';

const paths = [
  'docs/mechanics-audit/reviews/wu-ming-solo-superseded.json',
  'testcases/emulator_verified/wu_ming_solo_current_nc.json',
  'testcases/emulator_verified/wu_ming_rounding_followup_nc.json',
  'testcases/emulator_verified/wu_ming_s1_isolation_nc.json',
  'testcases/emulator_verified/wu_ming_s2_isolation_nc.json',
  'testcases/emulator_verified/wu_ming_marksman_vs_infantry_nc.json',
  'testcases/emulator_verified/wu_ming_bradley_current_nc.json',
  'testcases/emulator_verified/renee_wu_ming_s1_damage_kind_nc.json',
  'testcases/emulator_verified/retarget_lancer_screen_nc.json',
  'testcases/emulator_verified/army_term_precision_002i_003l.json',
];
const config = loadSimulatorConfig();
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const sourcePaths = ['simulator/src/damage.ts', 'simulator/src/damage.test.ts', 'simulator/src/tooling/testcases.test.ts',
  'simulator/config/hero_definitions/WuMing.json'];
const results = paths.map(path => {
  const text = readFileSync(resolve(path), 'utf8');
  const fixture = JSON.parse(text)[0];
  const input = adaptTestcaseEntry(fixture);
  const result = runPrepared(prepareBattle(input, config), 'outer-ceil-adoption', { mode: 'fast' });
  return { key: `${path}#0`, fixtureSha256: hash(text), game: fixture.game_report_result, input,
    simulator: { score: signedRemainingScore(result), rounds: result.rounds, remaining: result.remaining, deterministic: result.randomness.deterministic } };
});
const output = { generatedAt: new Date().toISOString(), phase: 'Fresh current-production replay after adopting the outer-ceil removal; original counterfactual artifacts remain unchanged.',
  sourceHashes: Object.fromEntries(sourcePaths.map(path => [path, hash(readFileSync(resolve(path)))])),
  configSha256: hash(JSON.stringify(config, null, 2) + '\n'), results };
writeFileSync(new URL('./adoption-check.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ sourceHashes: output.sourceHashes, rows: results.map(row => ({ key: row.key, game: row.game, simulator: row.simulator.score })) }, null, 2));
