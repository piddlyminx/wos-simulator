import { readFileSync } from "node:fs";

import { buildSimulatorConfig, loadSimulatorConfig, prepareBattle, runPrepared } from "../simulator/src/index";
import type { BattleInput, FighterInput, HeroSkillLevels, SimulatorConfig, SkillFile } from "../simulator/src/types";

type Side = "attacker" | "defender";
type UnitShape = "infantry" | "lancer" | "marksman" | "mixed";

interface TargetEffect {
  hero: string;
  effectId: string;
  label: string;
  candidates: string[];
  forcedLevels?: HeroSkillLevels;
}

interface Experiment {
  id: string;
  title: string;
  target: TargetEffect;
  side: Side;
  account: "minxxx" | "WIP";
  attackerTroops: Record<string, number>;
  defenderTroops: Record<string, number>;
  attackerHeroes: string[];
  defenderHeroes: string[];
  notes: string;
}

const playerHeroSkillsPath = process.env.WOS443_PLAYER_HERO_SKILLS ?? new URL("../skill/data/player_hero_skills.json", import.meta.url);
const playerSkills = JSON.parse(readFileSync(playerHeroSkillsPath, "utf8")) as Record<string, Record<string, HeroSkillLevels>>;
const baseConfig = loadSimulatorConfig();

const WIP_STATS = {
  inf: { attack: 73.8, defense: 76.4, lethality: 31.1, health: 38.1 },
  lanc: { attack: 78.8, defense: 71.2, lethality: 38.1, health: 28.8 },
  mark: { attack: 83.3, defense: 69.9, lethality: 37.6, health: 29.4 }
};

const MINXXX_STATS = {
  inf: { attack: 214.9, defense: 202.2, lethality: 118.6, health: 131.7 },
  lanc: { attack: 188.9, defense: 187.2, lethality: 120.8, health: 121.6 },
  mark: { attack: 205.9, defense: 203.2, lethality: 123.5, health: 124.5 }
};

const DAMAGE_UP = ["active.hero.damage.up", "active.hero.attack.up", "active.hero.lethality.up"];
const DAMAGE_DOWN = ["active.hero.damage.down", "active.hero.attack.down", "active.hero.lethality.down"];
const DAMAGE_TAKEN_DOWN = ["active.hero.damageTaken.down", "active.hero.defense.up", "active.hero.health.up"];
const DAMAGE_TAKEN_UP = ["active.hero.damageTaken.up", "active.hero.defense.down", "active.hero.health.down"];
const MAX_T6_PER_TYPE = 2999;

const experiments: Experiment[] = [
  {
    id: "edith_s1_marksman_damage_taken_down",
    title: "Edith S1/1 marksman damage taken down",
    target: { hero: "Edith", effectId: "StrategicBalance/1", label: "StrategicBalance/1", candidates: DAMAGE_TAKEN_DOWN },
    side: "defender",
    account: "minxxx",
    attackerTroops: { marksman_t6: 1280 },
    defenderTroops: { marksman_t6: 500 },
    attackerHeroes: [],
    defenderHeroes: ["Edith", "Zinman"],
    notes: "Class-valid defender lineup: Edith infantry, Zinman marksman. Zinman supplies active.hero.defense.up and active.hero.health.up references; damageTaken.down remains the separate-bucket candidate."
  },
  {
    id: "edith_s1_lancer_damage_dealt_up",
    title: "Edith S1/2 lancer damage dealt up",
    target: { hero: "Edith", effectId: "StrategicBalance/2", label: "StrategicBalance/2", candidates: DAMAGE_UP },
    side: "defender",
    account: "minxxx",
    attackerTroops: { infantry_t6: 1800 },
    defenderTroops: { lancer_t6: 650 },
    attackerHeroes: [],
    defenderHeroes: ["Edith", "Patrick", "Jasser"],
    notes: "Patrick supplies active.hero.attack.up reference; Jasser supplies active.hero.lethality.up reference; damage.up is the third candidate."
  },
  {
    id: "edith_s2_infantry_damage_taken_down",
    title: "Edith S2 infantry damage taken down",
    target: { hero: "Edith", effectId: "Ironclad/1", label: "Ironclad/1", candidates: DAMAGE_TAKEN_DOWN },
    side: "defender",
    account: "minxxx",
    attackerTroops: { infantry_t6: 1600 },
    defenderTroops: { infantry_t6: 500 },
    attackerHeroes: [],
    defenderHeroes: ["Edith", "Sergey", "Patrick"],
    notes: "Same discriminator as Edith S1/1, but infantry-only so Ironclad is the gated target effect."
  },
  {
    id: "gordon_s1_lancer_damage_dealt_up",
    title: "Gordon S1/1 lancer damage dealt up",
    target: { hero: "Gordon", effectId: "VenomInfusion/1", label: "VenomInfusion/1", candidates: DAMAGE_UP },
    side: "attacker",
    account: "minxxx",
    attackerTroops: { lancer_t6: 1000 },
    defenderTroops: { infantry_t6: 1800 },
    attackerHeroes: ["Gordon", "Patrick", "Jasser"],
    defenderHeroes: [],
    notes: "Long enough for every-2-attack trigger; Patrick attack-up and Jasser lethality-up are same-bucket references."
  },
  {
    id: "gordon_s1_target_damage_dealt_down",
    title: "Gordon S1/2 target damage dealt down",
    target: { hero: "Gordon", effectId: "VenomInfusion/2", label: "VenomInfusion/2", candidates: DAMAGE_DOWN },
    side: "defender",
    account: "minxxx",
    attackerTroops: { lancer_t6: 1500 },
    defenderTroops: { lancer_t6: 600 },
    attackerHeroes: [],
    defenderHeroes: ["Gordon", "Sergey", "Lynn"],
    notes: "Sergey supplies attack.down reference; Lynn supplies deterministic lethality.down reference; damage.down is the separate-bucket candidate."
  },
  {
    id: "gordon_s2_lancer_damage_dealt_up",
    title: "Gordon S2/1 lancer damage dealt up",
    target: { hero: "Gordon", effectId: "ChemicalTerror/1", label: "ChemicalTerror/1", candidates: DAMAGE_UP },
    side: "attacker",
    account: "minxxx",
    attackerTroops: { lancer_t6: 1000 },
    defenderTroops: { infantry_t6: 1800 },
    attackerHeroes: ["Gordon", "Patrick", "Jasser"],
    defenderHeroes: [],
    notes: "Long enough for every-3-turn trigger; same reference pair as Gordon S1/1."
  },
  {
    id: "gordon_s2_enemy_damage_dealt_down",
    title: "Gordon S2/2 all enemy damage dealt down",
    target: { hero: "Gordon", effectId: "ChemicalTerror/2", label: "ChemicalTerror/2", candidates: DAMAGE_DOWN },
    side: "defender",
    account: "minxxx",
    attackerTroops: { infantry_t6: 900, lancer_t6: 900, marksman_t6: 900 },
    defenderTroops: { lancer_t6: 800 },
    attackerHeroes: [],
    defenderHeroes: ["Gordon", "Sergey", "Lynn"],
    notes: "Mixed attacker proves enemy.any gating; Sergey and Lynn split attack.down vs deterministic lethality.down references."
  },
  {
    id: "gordon_s3_enemy_infantry_damage_taken_up",
    title: "Gordon S3/1 enemy infantry damage taken up",
    target: { hero: "Gordon", effectId: "ToxicRelease/1", label: "ToxicRelease/1", candidates: DAMAGE_TAKEN_UP, forcedLevels: { skill_1: 2, skill_2: 2, skill_3: 1 } },
    side: "attacker",
    account: "minxxx",
    attackerTroops: { lancer_t6: 1200 },
    defenderTroops: { infantry_t6: 1800 },
    attackerHeroes: ["Gordon", "Renee"],
    defenderHeroes: [],
    notes: "Simulator-only until Gordon S3 is unlocked in captured skills. Renee supplies active.hero.defense.down reference; health.down and damageTaken.up have no live reference in current hero data."
  },
  {
    id: "gordon_s3_enemy_marksman_damage_dealt_down",
    title: "Gordon S3/2 enemy marksman damage dealt down",
    target: { hero: "Gordon", effectId: "ToxicRelease/2", label: "ToxicRelease/2", candidates: DAMAGE_DOWN, forcedLevels: { skill_1: 2, skill_2: 2, skill_3: 1 } },
    side: "defender",
    account: "minxxx",
    attackerTroops: { marksman_t6: 1800 },
    defenderTroops: { lancer_t6: 700 },
    attackerHeroes: [],
    defenderHeroes: ["Gordon", "Sergey", "Lynn"],
    notes: "Simulator-only until Gordon S3 is unlocked in captured skills. Marksman-only attacker gates ToxicRelease/2; Sergey and Lynn split attack.down vs deterministic lethality.down references."
  },
  {
    id: "bradley_s2_damage_to_lancer_up",
    title: "Bradley S2/1 damage to lancer up",
    target: { hero: "Bradley", effectId: "PowerShot/1", label: "PowerShot/1", candidates: DAMAGE_UP },
    side: "attacker",
    account: "minxxx",
    attackerTroops: { marksman_t6: 900 },
    defenderTroops: { lancer_t6: 1800 },
    attackerHeroes: ["Bradley", "Jasser"],
    defenderHeroes: [],
    notes: "minxxx has stronger Bradley/Jasser levels than WIP for this discriminator. Bradley S1 supplies attack-up on the same hero; Jasser supplies lethality-up reference; lancer-only defender gates PowerShot/1."
  },
  {
    id: "bradley_s2_damage_to_infantry_up",
    title: "Bradley S2/2 damage to infantry up",
    target: { hero: "Bradley", effectId: "PowerShot/2", label: "PowerShot/2", candidates: DAMAGE_UP },
    side: "attacker",
    account: "minxxx",
    attackerTroops: { marksman_t6: 900 },
    defenderTroops: { infantry_t6: 1800 },
    attackerHeroes: ["Bradley", "Jasser"],
    defenderHeroes: [],
    notes: "minxxx has stronger Bradley/Jasser levels than WIP for this discriminator. Same as Bradley S2/1 with infantry-only defender to gate PowerShot/2."
  },
  {
    id: "bradley_s3_all_damage_up",
    title: "Bradley S3 all troops damage up",
    target: { hero: "Bradley", effectId: "TacticalAssistance/1", label: "TacticalAssistance/1", candidates: DAMAGE_UP },
    side: "attacker",
    account: "WIP",
    attackerTroops: { infantry_t6: 600, lancer_t6: 600, marksman_t6: 600 },
    defenderTroops: { infantry_t6: 900, lancer_t6: 900, marksman_t6: 900 },
    attackerHeroes: ["Bradley"],
    defenderHeroes: [],
    notes: "Class-valid attacker lineup uses Bradley only. Bradley S1/S2 already supply attack-up and lethality-up references while S3 remains the patched candidate; mixed long fight lets the every-4-turn all-troop effect fire more than once."
  }
];

const rows = experiments.map(runExperiment);
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));

function runExperiment(experiment: Experiment) {
  const tuned = tuneTroops(experiment);
  const outcomes = experiment.target.candidates.map((candidate) => {
    const config = configWithPatchedEffect(experiment.target.hero, experiment.target.effectId, candidate);
    const input = inputForExperiment(tuned.experiment);
    const result = runPrepared(prepareBattle(input, config), undefined, { mode: "fast" });
    const attacker = total(result.remaining.attacker);
    const defender = total(result.remaining.defender);
    return {
      candidate,
      winner: result.winner,
      rounds: result.rounds,
      attacker_remaining: attacker,
      defender_remaining: defender,
      signed_remaining_score: attacker - defender
    };
  });
  const scores = outcomes.map((outcome) => outcome.signed_remaining_score);
  return {
    id: experiment.id,
    title: experiment.title,
    target_effect: `${experiment.target.hero}/${experiment.target.effectId}`,
    account: experiment.account,
    emulator_runnable: experiment.target.forcedLevels === undefined,
    max_t6_per_type: MAX_T6_PER_TYPE,
    notes: experiment.notes,
    attacker_troops: tuned.experiment.attackerTroops,
    defender_troops: tuned.experiment.defenderTroops,
    outcomes,
    min_pair_gap: minPairGap(scores)
  };
}

function tuneTroops(experiment: Experiment): { experiment: Experiment; gap: number } {
  let best = { experiment, gap: -1 };
  for (let attackerStep = 20; attackerStep <= 500; attackerStep += 20) {
    for (let defenderStep = 20; defenderStep <= 500; defenderStep += 20) {
      const candidate = {
        ...experiment,
        attackerTroops: scaleTroops(experiment.attackerTroops, attackerStep / 100),
        defenderTroops: scaleTroops(experiment.defenderTroops, defenderStep / 100)
      };
      if (!withinTroopCap(candidate.attackerTroops) || !withinTroopCap(candidate.defenderTroops)) continue;
      const scores = candidate.target.candidates.map((type) => {
        const config = configWithPatchedEffect(candidate.target.hero, candidate.target.effectId, type);
        const result = runPrepared(prepareBattle(inputForExperiment(candidate), config), undefined, { mode: "fast" });
        return total(result.remaining.attacker) - total(result.remaining.defender);
      });
      const gap = minPairGap(scores);
      if (gap > best.gap) best = { experiment: candidate, gap };
    }
  }
  return best;
}

function scaleTroops(troops: Record<string, number>, scale: number): Record<string, number> {
  return Object.fromEntries(Object.entries(troops).map(([key, value]) => [key, Math.max(1, Math.round(value * scale))]));
}

function withinTroopCap(troops: Record<string, number>): boolean {
  return Object.values(troops).every((value) => value <= MAX_T6_PER_TYPE);
}

function configWithPatchedEffect(heroName: string, effectId: string, candidateType: string): SimulatorConfig {
  const heroDefinitions = structuredClone(baseConfig.heroDefinitions) as Record<string, SkillFile>;
  let patched = false;
  for (const skill of Object.values(heroDefinitions[heroName]?.skills ?? {})) {
    const effect = skill.effects?.[effectId];
    if (!effect) continue;
    effect.type = candidateType;
    patched = true;
  }
  if (!patched) throw new Error(`Missing ${heroName}/${effectId}`);
  return buildSimulatorConfig({
    troopStats: baseConfig.troopStats,
    heroGenerationStats: baseConfig.heroGenerationStats,
    troopSkills: baseConfig.troopSkills,
    heroDefinitions
  });
}

function inputForExperiment(experiment: Experiment): BattleInput {
  return {
    maxRounds: 300,
    attacker: fighter("attacker", experiment, experiment.attackerTroops, experiment.attackerHeroes),
    defender: fighter("defender", experiment, experiment.defenderTroops, experiment.defenderHeroes)
  };
}

function fighter(side: Side, experiment: Experiment, troops: Record<string, number>, heroes: string[]): FighterInput {
  const account = side === experiment.side ? experiment.account : oppositeAccount(experiment.account);
  return {
    name: `${account}-${side}`,
    troops,
    stats: account === "minxxx" ? MINXXX_STATS : WIP_STATS,
    heroes: Object.fromEntries(
      heroes.map((hero) => {
        const levels = hero === experiment.target.hero && experiment.target.forcedLevels ? experiment.target.forcedLevels : playerSkills[account]?.[hero];
        if (!levels) throw new Error(`Missing captured levels for ${account}/${hero}`);
        return [hero, levels];
      })
    )
  };
}

function oppositeAccount(account: "minxxx" | "WIP"): "minxxx" | "WIP" {
  return account === "minxxx" ? "WIP" : "minxxx";
}

function total(record: Record<UnitShape, number> | Record<string, number>): number {
  return Object.values(record).reduce((sum, value) => sum + Math.ceil(value), 0);
}

function minPairGap(values: number[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      min = Math.min(min, Math.abs(values[i] - values[j]));
    }
  }
  return Number.isFinite(min) ? min : 0;
}
