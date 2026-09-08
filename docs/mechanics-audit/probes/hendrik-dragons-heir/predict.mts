import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const manifest = read('manifest.json');
for (const [name, digest] of Object.entries(manifest.guardedFiles)) {
  assert.equal(hash(readFileSync(resolve(dir, name))), digest, `Frozen artifact changed: ${name}`);
}
const inputPath = resolve(process.argv[2] ?? resolve(dir, 'estimated-input.json'));
const outputPath = resolve(process.argv[3] ?? resolve(dir, 'prediction.json'));
const prospective = process.argv[4] === 'prospective';
assert(!existsSync(outputPath), 'Preserve existing artifacts; supply a new output path');
if (prospective) assert.equal(inputPath, resolve(dir, 'estimated-input.json'));
const inputText = readFileSync(inputPath, 'utf8');
const input = JSON.parse(inputText);
const spec = read('spec.json');
for (const side of ['attacker', 'defender']) {
  assert.deepEqual(input[side].heroes, spec[side].heroes, `Preserve ${side} full hero kit`);
  assert.deepEqual(input[side].troops, spec[side].troops, `Preserve ${side} exact troops`);
  assert.deepEqual(input[side].joiner_heroes ?? {}, {}, 'No joiners in this probe');
}
assert.equal(input.engagement_type ?? 'solo', 'solo');
const config = read('config-snapshot.json');
const source = read('runtime-snapshot.json');
const definitions = read('candidates.json');
const fields = [
  ...['attack','defense','lethality','health'].map(stat => ['attacker','mark',stat]),
  ...['inf','lanc','mark'].flatMap(unit => ['attack','defense','lethality','health'].map(stat => ['defender',unit,stat])),
];
for (const [side, unit, stat] of fields) assert(Number.isFinite(input[side].stats[unit][stat]));
let state = 20260909;
const random = () => ((state = (Math.imul(state,1664525) + 1013904223) >>> 0) / 4294967296);
const vectors = Array.from({length:256}, () => fields.map(() => (random() - .5) * .1));
for (let index = 0; index < fields.length; index++) {
  for (const sign of [-1,1]) vectors.push(fields.map((_,i) => i === index ? sign * .05 : 0));
}
for (const sign of [-1,1]) vectors.push(fields.map(([side]) => (side === 'attacker' ? sign : -sign) * .05));
const runtimeRoot = mkdtempSync(resolve(tmpdir(), 'wos-hendrik-s3-'));
try {
  const runtimes: Record<string, any> = {};
  for (const variant of ['current', 'outer_army_ceil_removed']) {
    const location = resolve(runtimeRoot, variant);
    mkdirSync(location);
    writeFileSync(resolve(location, 'package.json'), JSON.stringify({ type: 'module' }));
    for (const [path, text] of Object.entries(source.files) as [string,string][]) {
      assert(!path.startsWith('/') && !path.split('/').includes('..'));
      assert.equal(hash(text), source.fileHashes[path], `Runtime source changed: ${path}`);
      let code = text;
      if (variant === 'outer_army_ceil_removed' && path === source.outerCeilPatch.path) {
        const patch = source.outerCeilPatch;
        assert.equal(code.split(patch.from).length, 2, 'Expected exactly one arithmetic patch site');
        code = code.replace(patch.from, patch.to);
        assert.equal(hash(code), patch.resultSha256);
      }
      mkdirSync(dirname(resolve(location, path)), {recursive:true});
      writeFileSync(resolve(location, path), code);
    }
    runtimes[variant] = await import(pathToFileURL(resolve(location, 'simulator.ts')).href);
  }
  const candidates = Object.fromEntries(Object.entries(definitions).map(([name, definition]: [string,any]) => {
    const runtime = runtimes[definition.runtime];
    const variant = structuredClone(config);
    for (const patch of definition.patches) {
      const object = patch.path.slice(0,-1).reduce((o:any,k:string) => o[k], variant);
      const key = patch.path.at(-1);
      assert.deepEqual(object[key] ?? null, patch.from, `Candidate source changed: ${name}`);
      object[key] = structuredClone(patch.to);
    }
    const run = (sample:any, mode='fast') => runtime.runPrepared(runtime.prepareBattle(sample, variant), 'hendrik-s3-prospective-2026-09-07', {mode});
    const result = run(input,'trace');
    assert(result.randomness.deterministic, `Unexpected chance: ${name}`);
    const precision = vectors.map(vector => {
      const sample = structuredClone(input);
      fields.forEach(([side,unit,stat],i) => sample[side].stats[unit][stat] += vector[i]);
      const trial = run(sample);
      return { score:runtime.signedRemainingScore(trial), rounds:trial.rounds, remaining:trial.remaining.defender };
    });
    return [name, { score:runtime.signedRemainingScore(result), winner:result.winner, rounds:result.rounds,
      remaining:result.remaining, randomness:result.randomness, heroReport:result.skillReport.attacker.filter((row:any) => row.sourceKind === 'hero_skill'),
      s3Jobs:result.attacks.filter((job:any) => job.sourceEffectId === 'DragonsHeir/1').map((job:any) => ({round:job.round,kind:job.kind,target:job.takerUnit,rawKills:job.kills})),
      precisionRange:{ count:precision.length, min:Math.min(...precision.map(x => x.score)),max:Math.max(...precision.map(x => x.score)),
        rounds:[...new Set(precision.map(x => x.rounds))], minDefenderLine:Math.min(...precision.flatMap(x => Object.values(x.remaining) as number[])) },
      precisionSamples:precision }];
  }));
  const output = { generatedAt:new Date().toISOString(),phase:prospective ? 'prospective_conditional_prediction' : 'frozen_candidate_replay',
    inputPath,inputSha256:hash(inputText),input,manifestSha256:hash(readFileSync(resolve(dir,'manifest.json'))),candidateDefinitions:definitions,
    provenance:{ outcomeExposure:prospective ? 'No result from this Marksman probe has been opened. The preceding Hendrik Lancer-only capture matched17 and was known before this design.' : 'Replay from supplied input against the same frozen engines/config/candidates; preserve the prospective output.',
      stats:prospective ? 'Exact displayed report-resolved values from the preceding Hendrik3/3/3 Lancer battle2026-09-07 05:42:10, with attacker/defender roles reversed. Treat as conditional until this new battle report confirms all stats. No hero-generation bonus is added.' : 'Caller-supplied report-resolved stats. Verify identity, roles, full kit and troop keys before interpreting; no hero-generation bonus added.',
      arithmetic:'The current engine and outer-army-ceil counterfactual are frozen in runtime-snapshot.json. The latter only removes the outer army-term ceiling and retains the inner source-count ceiling. It is an independent arithmetic sensitivity, not a game observation or production change.' },
    uncertainty:{ statOffsets:[-.05,.05],fields,seed:20260909,vectors,note:'290 shared vectors:256 interior,32 coordinate endpoints,2 opposing corners. Sensitivity screen only, not exhaustive or an account-state drift allowance.' },candidates };
  writeFileSync(outputPath, JSON.stringify(output,null,2)+'\n', {flag:'wx'});
  console.log(JSON.stringify({outputPath,candidates:Object.fromEntries(Object.entries(candidates).map(([name,row]:[string,any]) => [name,{score:row.score,rounds:row.rounds,remaining:row.remaining.defender,precision:row.precisionRange,jobs:row.s3Jobs.length}]))},null,2));
} finally {
  rmSync(runtimeRoot,{recursive:true,force:true});
}
