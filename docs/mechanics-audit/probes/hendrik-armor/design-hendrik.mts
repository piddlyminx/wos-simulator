import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBattle, runPrepared, signedRemainingScore } from '../../../../simulator/src/simulator';
import type { BattleInput, SimulatorConfig } from '../../../../simulator/src/types';

const dir = dirname(fileURLToPath(import.meta.url));
const statsFile = resolve(process.argv[2] ?? resolve(dir, 'stats-input.json'));
if (!process.argv[3]) throw Error('Usage: design-hendrik.mts <stats-file> <new-replay-output>');
const outputFile = resolve(process.argv[3]);
const immutableFiles = ['input.json','spec.json','prediction.json','config-snapshot.json','stats-input.json','source-state.json'].map(name => resolve(dir,name));
if (immutableFiles.includes(outputFile) || outputFile === statsFile) throw Error(`Replay output cannot replace an input or frozen artifact: ${outputFile}`);
if (existsSync(outputFile)) throw Error(`Prediction already exists; choose a new output path to preserve the frozen original: ${outputFile}`);
const stats = JSON.parse(readFileSync(statsFile, 'utf8'));
const fixedInput: BattleInput = JSON.parse(readFileSync(resolve(dir,'input.json'),'utf8'));
const snapshotPath = resolve(dir, 'config-snapshot.json');
const snapshot = readFileSync(snapshotPath, 'utf8');
const base: SimulatorConfig = JSON.parse(snapshot);
const definitions = {
  configured: 'Hendrik S2 provides +18% Defense to all friendly troops on rounds4/5,8/9,... . Full3/3/3 kit; no Marksmen gates S3.',
  no_s2: 'Counterfactual S2 has no effect; equivalent here to S2 affecting Marksmen only.',
  damage_taken_down: 'Counterfactual S2 is18% Damage Taken Down with otherwise identical cadence/scope.',
  delayed_one_round: 'Counterfactual S2 activation persists one round later, rounds5/6,9/10,... .',
  one_round_duration: 'Counterfactual S2 lasts only the triggering round.',
  first_round_start: 'Counterfactual S2 first activates round1 then every4, lasting2 turns.',
  s1_10_percent: 'Diagnostic level-scaling alternative: S1 enemy Defense Down is10% rather than15%; S2 configured.',
  s1_20_percent: 'Diagnostic level-scaling alternative: S1 enemy Defense Down is20% rather than15%; S2 configured.',
  s3_uses_lancer: 'Diagnostic scope alternative: S3 uses the deployed Lancers as its source rather than requiring Marksmen; S2 configured.',
};
const variants = Object.fromEntries(Object.keys(definitions).map(name => [name, structuredClone(base)]));
for (const [name, config] of Object.entries(variants)) {
  const skill: any = config.heroDefinitions.Hendrik.skills.ArmorOfBarnacles;
  const effect = skill.effects['ArmorOfBarnacles/1'];
  if (name === 'no_s2') skill.effects = {};
  if (name === 'damage_taken_down') effect.type = 'active.hero.damageTaken.down';
  if (name === 'delayed_one_round') effect.duration.turns.delay = 1;
  if (name === 'one_round_duration') effect.duration.turns.count = 1;
  if (name === 'first_round_start') skill.trigger.first = 1;
  if (name.startsWith('s1_')) config.heroDefinitions.Hendrik.skills.WormsRavage.effects['WormsRavage/1'].value = [5, 10, name === 's1_10_percent' ? 10 : 20, 20, 25];
  if (name === 's3_uses_lancer') config.heroDefinitions.Hendrik.skills.DragonsHeir.effects['DragonsHeir/1'].units!.applies_to = 'lancer';
}
function simulate(input: BattleInput, config: SimulatorConfig, trace = false) {
  return runPrepared(prepareBattle(input, config), 'hendrik-prospective', { mode: trace ? 'trace' : 'fast' });
}
const input = structuredClone(fixedInput);
input.attacker.stats = stats.minxxx;
input.defender.stats = stats.WIP;
const results = Object.fromEntries(Object.entries(variants).map(([name, config]) => {
  const result = simulate(input, config);
  return [name, { score: signedRemainingScore(result), rounds: result.rounds }];
}));
const attacker = input.attacker.troops.lancer_t6;
const defender = input.defender.troops.lancer_t6;
const gap = Math.abs(results.configured.score - results.no_s2.score);
const diagnosticGap = Math.min(...['damage_taken_down','delayed_one_round','one_round_duration','first_round_start'].map(name => Math.abs(results.configured.score - results[name].score)));
const losses = attacker + defender - Math.abs(results.configured.score);
const selected = { attacker, defender, gap, diagnosticGap, losses, efficiency: gap / losses, results };
const parameters = ['attack','defense','lethality','health'];
const statsUnit = Object.hasOwn(stats.minxxx, 'lanc') ? 'lanc' : 'lancer';
const fields = ['attacker','defender'].flatMap(side => parameters.map(stat => [side, statsUnit, stat]));
let state = 20260908;
const random = () => ((state = (Math.imul(state,1664525) + 1013904223) >>> 0) / 4294967296);
const offsets = Array.from({length:256}, () => fields.map(() => (random() - .5) * .1));
for (let index = 0; index < fields.length; index++) for (const sign of [-1,1]) offsets.push(fields.map((_,i) => i === index ? sign * .05 : 0));
const predictions = Object.fromEntries(Object.entries(variants).map(([name,config]) => {
  const result = simulate(input,config,true);
  const precision = offsets.map(vector => {
    const sample: any = structuredClone(input);
    fields.forEach(([side,unit,stat],i) => sample[side].stats[unit][stat] += vector[i]);
    return signedRemainingScore(simulate(sample,config));
  });
  return [name, { score: signedRemainingScore(result), rounds: result.rounds, remaining: result.remaining,
    randomness: result.randomness, skillReport: result.skillReport.defender,
    extraSkillAttackJobsByEffect: result.extraSkillAttackJobsByEffect,
    statPrecisionSampleRange: { min:Math.min(...precision),max:Math.max(...precision),samples:precision.length },
  }];
}));
const output = { generatedAt: new Date().toISOString(), phase:'frozen_formation_replay',
  provenance: { ...stats.provenance, outcome_exposure: 'This is a replay using supplied stats. It makes no claim of blindness to game outcomes; the original prospective prediction is preserved separately.' },
  statsFile, configSnapshotSha256: createHash('sha256').update(snapshot).digest('hex'),
  candidateDefinitions: definitions, selected, input, predictions, shortlist:[selected],
  uncertainty: 'Sensitivity samples cover independent +/-0.05 percentage-point report precision only; not an exhaustive bound, nor a bound on account or equipment changes.',
};
writeFileSync(outputFile,JSON.stringify(output,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({selected,predictions},null,2));
