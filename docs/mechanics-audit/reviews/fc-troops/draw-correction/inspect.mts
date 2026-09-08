import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBattle, runPrepared, signedRemainingScore } from '../../../../../simulator/src/simulator';
import { battleScoreDelta } from '../../../../../simulator/src/tooling/testcases';
import { GATOT_GAME_OBSERVATIONS } from '../../../../../simulator/src/tooling/gatotEvidence';

const dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(dir, '../../../../..');
const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const hash = (path: string) => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');
const original = read('docs/mechanics-audit/reviews/fc-troops/results.json');
const config = read('docs/mechanics-audit/reviews/fc-troops/config-snapshot.json');
const sourceDraws = GATOT_GAME_OBSERVATIONS.filter(row => row.game.winner === 'draw').map(row => ({
  id: row.id, section: row.section, game: row.game, inputMaxRounds: row.buildInput?.(config).maxRounds,
  runnableInput: Boolean(row.buildInput),
}));
const files = readdirSync(resolve(root, 'testcases'), { recursive: true }).map(String).filter(path => path.endsWith('.json')).sort();
const bothSurviving: any[] = [], explicitDraws: any[] = [];
let acceptedEntries = 0, outcomeRows = 0;
for (const file of files) {
  const path = `testcases/${file}`, value = read(path), entries = Array.isArray(value) ? value : [value];
  for (const [index, entry] of entries.entries()) {
    if ([entry, entry.metadata ?? {}].some(record => record.invalid === true || record.obsolete === true ||
      [record.status, record.evidence_status].some(status => ['invalid', 'obsolete'].includes(status)))) continue;
    const outcomes = Array.isArray(entry.game_report_result) ? entry.game_report_result : entry.game_report_result ? [entry.game_report_result] : [];
    if (!outcomes.length) continue;
    acceptedEntries++; outcomeRows += outcomes.length;
    for (const [outcomeIndex, game] of outcomes.entries()) {
      const row = { key: `${path}#${index}`, outcomeIndex, game, inputMaxRounds: entry.maxRounds ?? entry.max_rounds ?? null,
        sourceGame: GATOT_GAME_OBSERVATIONS.find(row => row.id === entry.test_id)?.game ?? null, fixtureSha256: hash(path) };
      if (game.attacker > 0 && game.defender > 0) bothSurviving.push(row);
      if (game.winner === 'draw') explicitDraws.push(row);
    }
  }
}
const extraZeroReplays = original.results.filter((row: any) => !row.key.includes('/s8-')).flatMap((row: any) =>
  Object.entries(row.predictions).flatMap(([variant, prediction]: [string, any]) => {
    const indexes = prediction.samples.flatMap((score: number, index: number) => score === 0 ? [index] : []);
    if (!indexes.length) return [];
    assert.equal(variant, 'current', 'Add an explicit preserved variant definition before replaying another candidate');
    const fixture = read(row.key.split('#')[0])[0];
    return indexes.map((index: number) => {
      const seed = `${original.options.seed}:${fixture.test_id}#${index}`;
      const result = runPrepared(prepareBattle(row.input, config), seed, { mode: 'fast' });
      assert.equal(signedRemainingScore(result), 0);
      return { key: row.key, variant, index, seed, winner: result.winner, rounds: result.rounds,
        remaining: result.remaining, legacyScore: signedRemainingScore(result), correctedScore: battleScoreDelta(result) };
    });
  }));
const output = { generatedAt: new Date().toISOString(), acceptedEntries, outcomeRows,
  bothSurvivingEntries: new Set(bothSurviving.map(row => row.key)).size, bothSurvivingRows: bothSurviving.length,
  explicitDrawRows: explicitDraws.length, bothSurviving, explicitDraws, sourceDraws, extraZeroReplays,
  sourceHashes: Object.fromEntries(['simulator/src/tooling/testcases.ts', 'simulator/src/simulator.ts',
    'simulator/src/tooling/gatotEvidence.ts', 'simulator/src/tooling/exportGatotTestcases.ts',
    'docs/mechanics-audit/reviews/fc-troops/worker.mts', 'docs/mechanics-audit/reviews/fc-troops/results.json'].map(path => [path, hash(path)])) };
writeFileSync(resolve(dir, 'inspection.json'), JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ acceptedEntries, outcomeRows, bothSurvivingRows: bothSurviving.length,
  explicitDrawRows: explicitDraws.length, sourceDraws: sourceDraws.length, extraZeroReplays }, null, 2));
