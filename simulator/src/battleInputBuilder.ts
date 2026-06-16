import type { BattleInput, FighterInput, SideId, SimulatorConfig } from "./types";
import { applyHeroGenerationStats } from "./resolve";

/**
 * Ergonomic, order-independent constructor for a BattleInput.
 *
 * This is build-time scaffolding only — it does not run a simulation. Its job is to produce a
 * BattleInput whose FighterInput.stats are the final, authoritative player stats, so the
 * simulator core never has to massage the input. For example, addHeroGenerationStats() bakes
 * the main heroes' generation stats into each fighter's stat block, which the simulator used to
 * apply itself via the (now removed) hero_generation_stats mechanic.
 */
export class BattleInputBuilder {
  private readonly fighters: Partial<Record<SideId, FighterInput>> = {};
  private seedValue?: string | number;
  private maxRoundsValue?: number;
  private engagementTypeValue?: string;
  private bakeHeroGenerationStats = false;

  constructor(private readonly config: SimulatorConfig) {}

  fighter(side: SideId, input: FighterInput): this {
    this.fighters[side] = input;
    return this;
  }

  seed(seed: string | number): this {
    this.seedValue = seed;
    return this;
  }

  maxRounds(maxRounds: number): this {
    this.maxRoundsValue = maxRounds;
    return this;
  }

  engagement(engagementType: string): this {
    this.engagementTypeValue = engagementType;
    return this;
  }

  addHeroGenerationStats(add = true): this {
    this.bakeHeroGenerationStats = add;
    return this;
  }

  build(): BattleInput {
    const attacker = this.requireFighter("attacker");
    const defender = this.requireFighter("defender");
    const prepare = (fighter: FighterInput): FighterInput =>
      this.bakeHeroGenerationStats ? applyHeroGenerationStats(fighter, this.config) : fighter;
    return {
      attacker: prepare(attacker),
      defender: prepare(defender),
      ...(this.seedValue !== undefined ? { seed: this.seedValue } : {}),
      ...(this.maxRoundsValue !== undefined ? { maxRounds: this.maxRoundsValue } : {}),
      ...(this.engagementTypeValue !== undefined ? { engagement_type: this.engagementTypeValue } : {})
    };
  }

  private requireFighter(side: SideId): FighterInput {
    const fighter = this.fighters[side];
    if (!fighter) throw new Error(`BattleInputBuilder is missing the ${side} fighter`);
    return fighter;
  }
}
