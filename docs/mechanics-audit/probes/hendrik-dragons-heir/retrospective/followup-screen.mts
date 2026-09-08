import { readFileSync, writeFileSync } from 'node:fs';
import { loadSimulatorConfig } from '../../../../../simulator/src/config-node';
import { prepareBattle, runPrepared, signedRemainingScore } from '../../../../../simulator/src/simulator';

const input = JSON.parse(readFileSync(new URL('../captured-input.json', import.meta.url), 'utf8'));
const base = loadSimulatorConfig();
const configs = Object.fromEntries(['current','s3_first_two','s2_first_one','s2_delay_one'].map(name=>[name,structuredClone(base)]));
configs.s3_first_two.heroDefinitions.Hendrik.skills.DragonsHeir.trigger.first=2;
configs.s2_first_one.heroDefinitions.Hendrik.skills.ArmorOfBarnacles.trigger.first=1;
(configs.s2_delay_one.heroDefinitions.Hendrik.skills.ArmorOfBarnacles.effects['ArmorOfBarnacles/1'].duration as any).turns.delay=1;
const results=[];
for(const troops of [{infantry_t6:100,lancer_t6:100,marksman_t6:100},{infantry_t6:120,lancer_t6:80,marksman_t6:80},{infantry_t6:150,lancer_t6:60,marksman_t6:60}]) {
  for(const count of [150,200,250,300]) {
    const sample=structuredClone(input);sample.attacker.troops={marksman_t6:count};sample.defender.troops=troops;
    const predictions=Object.fromEntries(Object.entries(configs).map(([name,config])=>{
      const result=runPrepared(prepareBattle(sample,config),'hendrik-followup-screen',{mode:'fast'});
      return[name,{score:signedRemainingScore(result),rounds:result.rounds,remaining:result.remaining.defender}];
    }));
    const values=Object.values(predictions);
    if(values.every((r:any)=>r.score<0&&Object.values(r.remaining).every((n:any)=>n>=5))) {
      const scores=values.map((r:any)=>r.score);
      const primaryGap=Math.abs(predictions.current.score-predictions.s3_first_two.score);
      results.push({attacker:sample.attacker.troops,defender:troops,predictions,primaryGap,relativePrimaryGap:primaryGap/Math.abs(predictions.current.score)});
    }
  }
}
const output={phase:'conditional_simulator_screen_for_possible_followup',note:'Twelve bounded formations. Full kit and captured stats preserved. No future game outcome exists; not a completed or authorized live capture. All retained formations preserve all three defending lines under all candidates. Exact new report stats would require frozen-candidate replay.',results};
writeFileSync(new URL(process.argv[2]??'./followup-screen.json',import.meta.url),JSON.stringify(output,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(results.sort((a,b)=>b.relativePrimaryGap-a.relativePrimaryGap),null,2));
