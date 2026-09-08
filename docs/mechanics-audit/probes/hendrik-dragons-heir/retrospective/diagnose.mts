import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSimulatorConfig } from '../../../../../simulator/src/config-node';
import { prepareBattle, runPrepared, signedRemainingScore } from '../../../../../simulator/src/simulator';

const dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(dir, '../../../../..');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const base = loadSimulatorConfig();
const variants: Record<string, { description: string; config: any }> = {};
function variant(name: string, description: string, change = (_skills: any) => {}) {
  const config = structuredClone(base); change(config.heroDefinitions.Hendrik.skills);
  variants[name] = { description, config };
}
const s2 = (skills: any) => skills.ArmorOfBarnacles.effects['ArmorOfBarnacles/1'];
const s3 = (skills: any) => skills.DragonsHeir.effects['DragonsHeir/1'];
variant('current', 'Current adopted arithmetic and unchanged full Hendrik kit.');
variant('s2_delay_one', 'Previously frozen S2 alternative: active on rounds5/6,9/10,... instead of4/5,8/9,...', skills => s2(skills).duration.turns.delay = 1);
variant('s2_duration_one', 'Previously frozen S2 alternative: active only on the triggering round.', skills => s2(skills).duration.turns.count = 1);
variant('s2_damage_taken_down', 'Previously frozen S2 alternative: same18% value/cadence/scope in active.hero.damageTaken.down.', skills => s2(skills).type = 'active.hero.damageTaken.down');
variant('s2_first_one', 'Previously frozen S2 alternative: first turn1, then every4 turns.', skills => skills.ArmorOfBarnacles.trigger.first = 1);
variant('s3_first_two', 'One-turn earlier S3 phase: first turn2, then every3 turns.', skills => skills.DragonsHeir.trigger.first = 2);
variant('s3_first_four', 'One-turn later S3 phase: first turn4, then every3 turns.', skills => skills.DragonsHeir.trigger.first = 4);
variant('s3_delivery_delay_one', 'Keep turn3/6/... scheduling but delay each S3 effect one turn.', skills => s3(skills).duration = { turns: { count: 1, delay: 1 } });
variant('s3_normal_kind', 'Keep separate fanout jobs, changing only their damage kind from skill to normal.', skills => s3(skills).trigger_damage_jobs[0].damage_kind = 'normal');
variant('s3_actual_marksman_attacks', 'Every third actual Marksman normal-attack declaration instead of source-less turns.', skills => skills.DragonsHeir.trigger = { type: 'attack', every: 3, source: 'self.marksman', target: 'enemy.any' });
const fixtures = [
  { id: 'lancer', path: 'docs/mechanics-audit/probes/hendrik-armor/captured-input.json', heroSide: 'defender', game: { attacker:0,defender:17 }, gameDefender:{infantry:0,lancer:17,marksman:0} },
  { id: 'marksman', path: 'docs/mechanics-audit/probes/hendrik-dragons-heir/captured-input.json', heroSide: 'attacker', game:{attacker:0,defender:471}, gameDefender:{infantry:313,lancer:82,marksman:76} },
];
const results = fixtures.map(fixture => {
  const input = read(fixture.path);
  return { ...fixture, input, inputSha256:hash(readFileSync(resolve(root, fixture.path))), variants:Object.fromEntries(Object.entries(variants).map(([name, candidate]) => {
    const result = runPrepared(prepareBattle(input, candidate.config), 'hendrik-retrospective', { mode:'trace' });
    const jobs = result.attacks.filter((job:any) => job.sourceEffectId === 'DragonsHeir/1');
    const report = result.skillReport[fixture.heroSide as 'attacker'|'defender'].filter((row:any) => row.sourceKind === 'hero_skill');
    return [name,{score:signedRemainingScore(result),rounds:result.rounds,remaining:result.remaining,heroReport:report,
      s3Jobs:jobs.map((job:any) => ({round:job.round,kind:job.kind,target:job.takerUnit,kills:job.kills,sourceTroops:job.roundStartTroops?.[fixture.heroSide]?.marksman})),
      s3RawKills:jobs.reduce((sum:any,job:any) => sum+job.kills,0),
      s2UsedRounds:[...new Set(result.attacks.filter((job:any) => job.appliedEffects?.some((effect:any) => effect.effectId === 'ArmorOfBarnacles/1')).map((job:any) => job.round))],
      deterministic:result.randomness.deterministic}];
  })) };
});
const paths=['simulator/src/damage.ts','simulator/src/simulator.ts','simulator/src/extraAttacks.ts','simulator/config/hero_definitions/Hendrik.json','simulator/config/troop_skills.json'];
const output={generatedAt:new Date().toISOString(),phase:'retrospective_diagnosis',outcomeExposure:'Both captured endpoints, the Marksman defender vector313/82/76, and reported S2/S3 counts5/6 were known before defining/running this screen. No live skills disabled. No parameter sweep or production change.',
  sourceHashes:Object.fromEntries(paths.map(path=>[path,hash(readFileSync(resolve(root,path)))])),configSha256:hash(JSON.stringify(base,null,2)+'\n'),
  candidateDefinitions:Object.fromEntries(Object.entries(variants).map(([name,row])=>[name,row.description])),results};
const outputPath=resolve(dir,process.argv[2]??'diagnosis.json');
if(existsSync(outputPath)) throw Error('Preserve existing diagnosis; select a new output path.');
writeFileSync(outputPath,JSON.stringify(output,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(results.map(row=>({id:row.id,game:row.game,variants:Object.fromEntries(Object.entries(row.variants).map(([name,r]:[string,any])=>[name,{score:r.score,rounds:r.rounds,remaining:r.remaining.defender,activations:r.heroReport.map((h:any)=>h.skillActivations),s3Kills:r.s3RawKills}]))})),null,2));
