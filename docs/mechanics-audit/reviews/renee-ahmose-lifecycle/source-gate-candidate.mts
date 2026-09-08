import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { adaptTestcaseEntry } from '../../../../simulator/src/tooling/testcases';

const dir = dirname(fileURLToPath(import.meta.url)), root = resolve(dir, '../../../..');
const probe = resolve(dir, '../../probes/ahmose-no-infantry');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const hash = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const config = read(join(probe, 'config.json')), archive = read(join(probe, 'runtime-manifest.json'));
assert.equal(hash(join(probe, 'runtime.tar.gz')), archive.archive_sha256);
const cases = read(join(dir, 'cases.json'));
const inventory = read(resolve(root, 'docs/mechanics-audit/inventory.json'));
const active: any[] = inventory.fixtures.map((fixture: any) => {
  const path = resolve(root, fixture.path), contents = readFileSync(path), raw = JSON.parse(contents.toString());
  const entry = Array.isArray(raw) ? raw[fixture.index] : raw;
  return { key: fixture.key, input: adaptTestcaseEntry(entry), game: entry.game_report_result, sourceSha256: createHash('sha256').update(contents).digest('hex') };
});
const noInfKey = 'testcases/emulator_verified/ahmose_no_infantry_240l_vs_125i.json#0';
if (!active.some(c => c.key === noInfKey)) {
  const path = resolve(root, noInfKey.split('#')[0]), entry = read(path)[0];
  active.push({ key: noInfKey, input: adaptTestcaseEntry(entry), game: entry.game_report_result, sourceSha256: hash(path) });
}
const archived = Object.values(cases).filter((c: any) => c.key.startsWith('archive:')) as any[];
const followup = read(join(probe, 'source-death/estimated-input-v2.json'));
const temp = mkdtempSync(join(tmpdir(), 'wos-viper-source-gate-'));
function patch(path: string, before: string, after: string) {
  const source = readFileSync(path, 'utf8'); assert.equal(source.split(before).length, 2, path);
  writeFileSync(path, source.replace(before, after));
}
try {
  for (const name of ['baseline', 'candidate']) {
    execFileSync('mkdir', ['-p', join(temp, name)]);
    execFileSync('tar', ['-xzf', join(probe, 'runtime.tar.gz'), '-C', join(temp, name)]);
    for (const [path, sha] of Object.entries(archive.source_files)) assert.equal(hash(join(temp, name, path)), sha, path);
  }
  const runtimeSkills = join(temp, 'candidate/runtimeSkills.ts'), simulator = join(temp, 'candidate/simulator.ts');
  patch(runtimeSkills, '  ResolvedFighter,', '  ResolvedFighter,\n  ResolvedUnitScope,');
  patch(runtimeSkills, 'export interface PreparedRoundSkill {\n  skill: ResolvedSkill;', 'export interface PreparedRoundSkill {\n  skill: ResolvedSkill;\n  source?: ResolvedUnitScope;');
  patch(runtimeSkills, '      roundStart.push({\n        skill,', '      roundStart.push({\n        skill,\n        ...(skill.trigger.source === undefined ? {} : { source: trigger.source }),');
  patch(simulator, '    const { skill } = prepared;\n    recorder.recordSkillTriggerAttempt(skill);', '    const { skill, source } = prepared;\n    if (source && !UNIT_TYPES.some(unit => unitMaskHas(source.units, unit) && runtime.troops[source.side][unit] > 0)) continue;\n    recorder.recordSkillTriggerAttempt(skill);');
  const candidateConfig = structuredClone(config);
  candidateConfig.heroDefinitions.Ahmose.skills.ViperFormation.trigger.source = 'infantry';
  const protocol = {
    createdAt: new Date().toISOString(),
    exposure: 'Retrospective for300 active and2 archived outcomes, prospective for the1I+480L/250I follow-up. No production edits. All frozen engines/configs identical except explicit turn-source liveness support and Viper source=infantry.',
    behavior: 'An explicitly sourced turn trigger requires at least one living matching source line when its scheduled turn arrives. Source-less turn triggers retain their behavior. Already activated effects keep their duration. No change to cadence, coefficients, RNG or normal-attack counters.',
    archiveSha256: archive.archive_sha256,
    patchedSourceHashes: { runtimeSkills: hash(runtimeSkills), simulator: hash(simulator) },
    scriptSha256: hash(fileURLToPath(import.meta.url)),
    active, archived, prospectiveFollowup: followup,
    validationScope: 'One identical seed per active/archived input checks structural parity outside Ahmose. This is not fresh distribution validation for each stochastic fixture.',
  };
  writeFileSync(join(dir, 'source-gate-protocol.json'), JSON.stringify(protocol, null, 2) + '\n', { flag: 'wx' });
  const baseline = await import(pathToFileURL(join(temp, 'baseline/simulator.ts')).href);
  const candidate = await import(pathToFileURL(join(temp, 'candidate/simulator.ts')).href);
  const results: any[] = [];
  for (const test of [...active, ...archived, { key: 'prospective:source-death', input: followup, game: null }]) {
    const outputs: any = {};
    for (const [name, engine, c] of [['baseline', baseline, config], ['candidate', candidate, candidateConfig]] as any[]) {
      const r = engine.runPrepared(engine.prepareBattle(test.input, c), `source-gate:${test.key}`, { mode: 'fast' });
      outputs[name] = { winner: r.winner, rounds: r.rounds, remaining: r.remaining, skillReport: r.skillReport, effectActivationCounts: r.effectActivationCounts, randomness: r.randomness };
    }
    const changed = JSON.stringify(outputs.baseline) !== JSON.stringify(outputs.candidate);
    const ahmose = ['attacker', 'defender'].some(side => test.input[side].heroes?.Ahmose);
    assert(!changed || ahmose, `Unrelated input changed: ${test.key}`);
    results.push({ key: test.key, game: test.game, ahmose, changed, ...outputs });
    if (changed) console.log(JSON.stringify({ key: test.key, baseline: outputs.baseline.remaining, candidate: outputs.candidate.remaining }));
  }
  writeFileSync(join(dir, 'source-gate-results.json'), JSON.stringify({ activeCount: active.length, archivedCount: archived.length, results }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ rows: results.length, changed: results.filter(r => r.changed).length, unrelatedUnchanged: results.filter(r => !r.ahmose).length }));
} finally { rmSync(temp, { recursive: true, force: true }); }
