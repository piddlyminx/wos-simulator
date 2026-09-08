import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSimulatorConfig } from '../../../../simulator/src/config-node';
import { adaptTestcaseEntry, battleScoreDelta } from '../../../../simulator/src/tooling/testcases';
import { compareOutcomeDistribution } from '../../../../simulator/src/tooling/parityMetrics';
import { BatchWorkerPool } from '../../../../simulator/src/workerPool';
import { WorkerThreadBatchWorker } from '../../../../scripts/workerThreadBatchWorker';

const dir = dirname(fileURLToPath(import.meta.url)), root = resolve(dir, '../../../..');
const output = resolve(dir, 'results.json');
assert(!existsSync(output), 'Preserve original review output.');
const digest = (file: string) => createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
const sourceFiles = readdirSync(resolve(root, 'simulator/src'), { recursive: true }).map(String)
  .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts')).map(file => `simulator/src/${file}`);
const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file, digest(file)]));
const config = loadSimulatorConfig();
const configText = JSON.stringify(config, null, 2) + '\n';
writeFileSync(resolve(dir, 'config-snapshot.json'), configText, { flag: 'wx' });
const variants: Record<string, any> = { current_extra_increment: config, extra_full_tooltip: structuredClone(config), normal_increment: structuredClone(config) };
variants.extra_full_tooltip.heroDefinitions.Philly.skills.DosageBoost.effects['DosageBoost/1'].value = [120, 140, 160, 180, 200];
const normal = variants.normal_increment.heroDefinitions.Philly.skills.DosageBoost.effects['DosageBoost/1'];
normal.type = 'type.normal.damage.up';
normal.applies_to_damage_kinds = ['normal'];
normal.duration = { attacks: { count: 1 } };
delete normal.trigger_damage_jobs;
const cases = [
  ['testcases/3-testcases_mixed-heroes-not-verified.json', 5],
  ['testcases/emulator_verified/philly_solo.json', 0],
  ['testcases/emulator_verified/philly_solo.json', 1],
  ['testcases/emulator_verified/philly_bahiti_combo.json', 0],
  ['testcases/emulator_verified/philly_bahiti_combo.json', 1],
  ['testcases/emulator_verified/wos425_wip_philly_defense.json', 0],
  ['testcases/emulator_verified/wos425_wip_sergey_philly_combo.json', 0],
  ['testcases/emulator_verified/wos427_wip_sergey_philly_840.json', 0],
] as const;
const options = { repeat: 1000, workers: 4, seed: 'philly-dosage-interpretation-2026-09-07' };
const total = (fighter: any) => Object.values(fighter.troops).reduce((sum: number, count: any) => sum + count, 0);
const pool = new BatchWorkerPool(options.workers, () => new WorkerThreadBatchWorker(new URL('./worker.mts', import.meta.url)));
try {
  const results = await Promise.all(cases.map(async ([file, index]) => {
    const fixtureSha256 = digest(file), entry = JSON.parse(readFileSync(resolve(root, file), 'utf8'))[index];
    const input = adaptTestcaseEntry(entry);
    const gameOutcomes = Array.isArray(entry.game_report_result) ? entry.game_report_result : [entry.game_report_result];
    const game = gameOutcomes.map(battleScoreDelta);
    const key = `${file}#${index}`;
    const predictions = Object.fromEntries(await Promise.all(Object.entries(variants).map(async ([name, candidate]) => {
      const result: any = await pool.runTask({ input, config: candidate, repeat: options.repeat, seed: `${options.seed}:${key}` });
      const comparison = compareOutcomeDistribution({ candidate: { samples: result.samples }, reference: { samples: game },
        initialTroops: total(input.attacker) + total(input.defender), outcomeRange: { min: -total(input.defender), max: total(input.attacker) }, deterministic: result.firstSample.deterministic });
      console.log(JSON.stringify({ key, variant: name, game, mean: comparison.mu_candidate, sd: comparison.sigma_candidate, p: comparison.p }));
      return [name, { ...result, comparison }];
    })));
    assert.equal(digest(file), fixtureSha256, `Fixture changed: ${file}`);
    return { key, fixtureSha256, input, gameOutcomes, game, predictions };
  }));
  for (const [file, expected] of Object.entries(sourceHashes)) assert.equal(digest(file), expected, `Engine changed: ${file}`);
  assert.equal(JSON.stringify(loadSimulatorConfig(), null, 2) + '\n', configText, 'Config changed during review.');
  writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), options, sourceHashes,
    configSha256: createHash('sha256').update(configText).digest('hex'),
    interpretation: 'Retrospective accepted-evidence challenge. Full recorded kits, stats, troops and outcomes retained. All three alternatives are simulator-only counterfactuals; no live skill disabling or fitted stats. Score is surviving attackers minus defenders, including draws. Per-side outcomes, winner and rounds preserved.',
    variants: {
      current_extra_increment: 'Current Philly separate skill attack for20/40/60/80/100; at level2 normal100 plus extra40.',
      extra_full_tooltip: 'Only change Philly extra skill coefficient to120/140/160/180/200; at level2 normal100 plus extra140.',
      normal_increment: 'Keep20/40/60/80/100 but apply to current normal damage factor for one attack, no separate skill job. At level2 a140%-total normal attack absent other modifiers. Existing normal-factor modifiers combine additively; this does not assert universal replacement semantics.',
    }, results }, null, 2) + '\n', { flag: 'wx' });
} finally { await pool.close(); }
