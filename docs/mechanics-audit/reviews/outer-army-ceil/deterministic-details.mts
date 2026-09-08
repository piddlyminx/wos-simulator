import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepareBattle as prepareCurrent, runPrepared as runCurrent } from '../../../../simulator/src/simulator';
import { prepareBattle as prepareCandidate, runPrepared as runCandidate } from '../../../../tmp/mechanics-audit-2026-09-07/nohero-mixed/runtimes/fractional_army_term/simulator';

const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
const screen = JSON.parse(readFileSync(new URL('./results.json', import.meta.url), 'utf8'));
const total = (counts: any) => Object.values(counts).reduce((sum: number, count: any) => sum + count, 0);
const results = screen.results.filter((row: any) => row.deterministic).map((row: any) => {
  const [path, index] = row.key.split('#');
  const parsed = JSON.parse(readFileSync(resolve(path), 'utf8'));
  const fixture = Array.isArray(parsed) ? parsed[Number(index)] : parsed;
  const observations = Array.isArray(fixture.game_report_result) ? fixture.game_report_result : [fixture.game_report_result];
  const before = runCurrent(prepareCurrent(row.input, config), 'deterministic-outer-ceil', { mode: 'fast' });
  const after = runCandidate(prepareCandidate(row.input, config), 'deterministic-outer-ceil', { mode: 'fast' });
  const describe = (result: any) => ({ rounds: result.rounds, remaining: result.remaining,
    survivors: { attacker: total(result.remaining.attacker), defender: total(result.remaining.defender) },
    maxSideError: Math.max(...observations.flatMap((o: any) => ['attacker', 'defender'].map(side => Math.abs(total(result.remaining[side]) - o[side])))) });
  return { key: row.key, gameObservations: observations, baseline: describe(before), candidate: describe(after) };
});
writeFileSync(new URL('./deterministic-details.json', import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(),
  purpose: 'Check both survivor totals separately, especially draws capped at maxRounds, so signed-score cancellation cannot conceal a material change.',
  newSideFailures: results.filter((r: any) => r.baseline.maxSideError <= 2 && r.candidate.maxSideError > 2).map((r: any) => r.key), results }, null, 2) + '\n');
console.log(JSON.stringify(results.filter((r: any) => r.baseline.maxSideError <= 2 && r.candidate.maxSideError > 2), null, 2));
