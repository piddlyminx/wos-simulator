import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSimulatorConfig } from '../../../../../simulator/src/config-node';
import { adaptTestcaseEntry } from '../../../../../simulator/src/tooling/testcases';

const dir = dirname(fileURLToPath(import.meta.url)), root = resolve(dir, '../../../../..');
const output = resolve(dir, 'definitions.json');
assert(!existsSync(output), 'Preserve frozen retrospective definitions.');
const digest = (file: string) => createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
const config = loadSimulatorConfig();
const configText = JSON.stringify(config, null, 2) + '\n';
writeFileSync(resolve(dir, 'config-snapshot.json'), configText, { flag: 'wx' });
const sourceFiles = readdirSync(resolve(root, 'simulator/src'), { recursive: true }).map(String)
  .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts')).map(file => `simulator/src/${file}`);
sourceFiles.push('simulator/config/hero_definitions/Hendrik.json');
const fixtures = [
  'testcases/emulator_verified/hendrik_armor_lancer_scope.json',
  'testcases/emulator_verified/hendrik_dragons_heir_250m_vs_400i_100l_100m.json',
  'testcases/emulator_verified/hendrik_small_timing_250m_vs_150i_60l_60m.json',
  'testcases/emulator_verified/renee_hendrik_defense_bucket_nc.json',
].map(file => {
  const rows = JSON.parse(readFileSync(resolve(root, file), 'utf8'));
  assert.equal(rows.length, 1);
  return { key: `${file}#0`, fixtureSha256: digest(file), input: adaptTestcaseEntry(rows[0]), game: rows[0].game_report_result };
});
const variants = {
  current: { description: 'Unchanged S2 first4/every4, duration2; S3 first3/every3.' },
  s2_first_three: { description: 'Only S2 begins one turn earlier: first3/every4; keep duration2.', s2First: 3 },
  s3_first_two: { description: 'Only S3 begins one turn earlier: first2/every3.', s3First: 2 },
  shared_first_n_minus_one: { description: 'Shared initial offset: S2 first3/every4 and S3 first2/every3; no interval/duration changes.', s2First: 3, s3First: 2 },
  s2_first_one: { description: 'Previously frozen foil: S2 first1/every4; unchanged S3.', s2First: 1 },
  s2_delay_one: { description: 'Previously frozen foil: normal S2 cadence but delay its two-turn window by one turn.', s2Delay: 1 },
  s2_duration_one: { description: 'Previously reviewed disconfirmation: normal S2 cadence with only one turn of protection.', s2Duration: 1 },
  s2_damage_taken_down: { description: 'Previously reviewed bucket foil: same S2 coefficient/cadence in damageTaken.down.', s2Type: 'active.hero.damageTaken.down' },
  s3_first_four: { description: 'Previously reviewed opposite S3 offset: first4/every3.', s3First: 4 },
  s3_first_two_s2_first_one: { description: 'Combine the already motivated S3-first2 and alternative S2-first1 schedules; no coefficient change.', s2First: 1, s3First: 2 },
};
writeFileSync(output, JSON.stringify({ frozenAt: new Date().toISOString(), phase: 'retrospective_before_candidate_simulations',
  exposure: 'All three 2026-09-07 Hendrik totals D17/D471/D68 and reported activation totals were known before this definition. Prior D471 vector313/82/76 is known. Third D68 per-line outcome is not yet supplied/inspected at this freeze. Historical Renee/Hendrik A14 is accepted and known. No reported activation count is interpreted as measured rounds.',
  contract: 'Preserve full recorded hero kits, all accepted Hendrik fixture inputs, exact troops/stats, source-troop ceiling and fractional survivor state. No fitted coefficients, production edits or new live actions. Scoring is A-D including draws; retain each side/winner/rounds and actual modeled effect use.',
  sourceHashes: Object.fromEntries(sourceFiles.map(file => [file, digest(file)])),
  configSha256: createHash('sha256').update(configText).digest('hex'), variants, fixtures }, null, 2) + '\n', { flag: 'wx' });
console.log(output);
