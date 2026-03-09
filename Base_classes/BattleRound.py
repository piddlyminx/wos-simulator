import json
import math
from Base_classes.Fighter import Fighter
from Base_classes.UnitType import UnitType, _to_unitx, prettify
from Base_classes.Skill import Skill, Effect, RoundEffect, Benefit

class BattleRound():
    """Represents a single round of battle between two fighters.
    
    Handles calculation of troops remaining, skill activation, damage bonuses,
    and casualties for one round of combat.
    
    Attributes:
        DEBUG (bool): Enable debug output for battle calculations.
        DEBUG_FREQ (int): Frequency of debug output (every N rounds).
        DEBUG_MAX_ROUND (int): Maximum round to output debug information.
    """
    DEBUG = False
    DEBUG_FREQ = 10
    DEBUG_MAX_ROUND = 10
    
    def __init__(self, fighter: Fighter, opponent: Fighter, round_idx, army_min) -> None:
        """Initialize a battle round.
        
        Args:
            fighter: The attacking fighter for this round.
            opponent: The defending fighter for this round.
            round_idx: The current round index (0-based).
            army_min: Minimum army size between both fighters.
        """
        # Init
        self.fighter = fighter
        self.opponent = opponent
        self.round_idx = round_idx
        self.army_min = army_min

        # prepare
        self.round_troops = {}
        self.targets = {}

        # effects
        self.round_effects = []
        self.order_effects = []
        self.dodge_effects = []
        # benefits
        self.round_benefits = []

        # results
        self.round_kills = {}
        self.round_dmg_coef = {ut:0 for ut in UnitType}
        # self.need_continue_skills = {}  # Not used for now

        # Calc Round troops
        self.calc_round_troops()


    def get_results(self):
        """Calculate and store battle results for this round.
        
        Computes casualties inflicted by this fighter on the opponent.
        """
        self.calc_round_kills()
        
    def calc_round_troops(self):
        """Calculate remaining troops for this round.
        
        For round 0, copies initial troop counts. For subsequent rounds,
        calculates remaining troops after casualties from previous round.
        """
        if self.round_idx == 0 :
            self.round_troops = self.fighter.troops_by_type.copy()
        else :
            for ut in UnitType:
                self.round_troops[ut] = max(0, self.fighter.rounds[self.round_idx - 1].round_troops[ut] - sum(vs[ut] if ut in vs else 0 for vs in self.opponent.rounds[self.round_idx -1].round_kills.values()) )
    
    def calc_skills(self):
        """Calculate and apply all skill effects for this round.
        
        Determines which skills activate and identifies attack targets.
        """
        self.calc_round_effects()
        self.calc_targets()

    def calc_round_effects(self):
        """Activate all skill effects that meet their conditions this round.
        
        Checks each effect's skill and effect conditions, adding active
        effects to appropriate lists (order, dodge, or standard effects).
        """
        for effect in self.fighter.effects:
            if effect._skill.r_skill_condition(self.fighter, self.round_idx):
                if effect.r_effect_condition(self.fighter, self.opponent, self.round_idx):
                    self.add_round_effect(effect)
    
    def add_round_effect(self, effect: Effect):
        """Add an activated effect to the appropriate list for this round.
        
        Args:
            effect: The effect to add.
            
        Effects are categorized by type:
        - attack_order: Added to order_effects
        - dodge: Added to dodge_effects  
        - others: Added to round_effects
        """
        effect.activations_count += 1
        if 'attack_order' in effect.type.lower():
            self.order_effects.append(RoundEffect(effect, self.round_idx))
        elif 'dodge' in effect.type.lower():
            self.dodge_effects.append(RoundEffect(effect, self.round_idx))
        else:
            self.round_effects.append(RoundEffect(effect, self.round_idx))
    
    def calc_targets(self):
        """Determine attack targets for each unit type.
        
        Calculates which enemy unit type each of this fighter's unit types
        will attack, considering attack order effects.
        """
        for ut, num in self.round_troops.items():
            if not num: continue
            self.targets[ut] = self.get_unit_target(ut)
    
    def get_unit_target(self, ut: UnitType):
        """Get the target unit type for a given attacking unit type.
        
        Args:
            ut: The attacking unit type.
            
        Returns:
            UnitType: The enemy unit type to target, or None if no valid target.
            
        Lancers may have modified attack order from skills.
        """
        attack_order = UnitType.list()
        if ut == UnitType.lanc:                 # For simplification: lancers only. To update later if needed
            if self.order_effects:
                if self.order_effects[-1].trigger_condition(self.fighter, self.opponent, ut, UnitType.inf, self.round_idx):
                    attack_order = [_to_unitx(_t) for _t in self.order_effects[-1]._effect.value.split('/')]
                    self.order_effects[-1]._effect.trigger_count += 1
                    self.order_effects[-1]._effect.uses_count += 1
        for vs in attack_order:
            if self.opponent.rounds[self.round_idx].round_troops[vs] > 0 : return vs
        
    def calc_benefits(self):
        """Calculate all active benefits from skills for this round.
        
        Processes offensive and defensive effects, creating benefit objects
        that will modify damage calculations. Carries over multi-turn benefits
        from previous rounds.
        """
        defense_effects = []
        for r_effect in self.round_effects:
            r_effect : RoundEffect
            if ('onDefense' in r_effect._effect.special) and r_effect._effect.special['onDefense'] :
                defense_effects.append(r_effect)
                continue
            for ut in UnitType:
                if not self.round_troops[ut]: continue
                target = self.targets.get(ut)
                if target is None: continue
                if r_effect.trigger_condition(self.fighter, self.opponent, ut, target, self.round_idx):
                    benefit = r_effect.activate_effect(self.fighter, ut, target)
                    self.round_benefits.append(benefit)
        
        for r_effect in defense_effects:
            r_effect : RoundEffect
            for vs in UnitType:
                if not self.opponent.rounds[self.round_idx].round_troops[vs]: continue
                victim = self.opponent.rounds[self.round_idx].targets[vs]
                if r_effect.trigger_condition(self.fighter, self.opponent, victim, vs, self.round_idx):
                    benefit = r_effect.activate_effect(self.fighter, victim, vs)
                    # print(f"___ (R{self.round_idx}-{self.fighter.name}) DEBUG: r_effect onDefense: {r_effect.r_eff_id} ACTIVATED for my {victim.name} vs {vs.name}, defense_effects = {defense_effects}")
                    self.round_benefits.append(benefit)
        
        if self.round_idx > 0:
            for benefit in self.fighter.rounds[self.round_idx - 1].round_benefits:
                benefit: Benefit
                if benefit.is_valid("any", "any", self.round_idx):
                    self.round_benefits.append(benefit)
        
        if BattleRound.DEBUG and self.round_idx % BattleRound.DEBUG_FREQ == 0 and self.round_idx < self.DEBUG_MAX_ROUND:
            print(f'\nBENEFITS ---> R{self.round_idx} - {self.fighter.name} ')
            for benefit in self.round_benefits:
                print(f"        - {benefit}")
    
    def calc_dodging_benefits(self, ut, target):
        """Check and apply opponent's dodge effects.
        
        Args:
            ut: The attacking unit type.
            target: The target unit type being attacked.
            
        If opponent has active dodge effects that trigger, adds dodge
        benefits to opponent's round benefits.
        """
        opp_dodge_effects = self.opponent.rounds[self.round_idx].dodge_effects
        if opp_dodge_effects:
            for r_effect in opp_dodge_effects:
                r_effect: RoundEffect
                if r_effect.trigger_condition(self.fighter, self.opponent, target, ut, self.round_idx):
                    self.opponent.rounds[self.round_idx].round_benefits.append(r_effect.activate_effect(self.fighter, target, ut))

    def calc_round_kills(self):
        """Calculate casualties inflicted by this fighter this round.
        
        For each unit type, calculates base damage, applies skill bonuses and
        debuffs, and stores resulting casualties.
        """
        if BattleRound.DEBUG and self.round_idx % BattleRound.DEBUG_FREQ == 0 and self.round_idx < self.DEBUG_MAX_ROUND:
            print(f"\n🔹🔹🔹🔹🔹🔹🔹🔹  R{self.round_idx} : BONUS CALCS - {self.fighter.name}")
              
        for ut in UnitType:
            # army size
            army = self.calc_round_army(ut)
            if army == 0:
                continue

            # get Target
            target = self.targets[ut]

            # check Dodging
            self.calc_dodging_benefits(ut, target)

            # calc Unit Base Damage
            unit_base_dmg = army * self.fighter.attack_by_type[ut] / self.opponent.defense_by_type[target] / 100

            # Calc kills with bonus dmg
            ut_kills = self.calc_bonus_dmg(unit_base_dmg, ut, target)

            ### ROUNDING: Try later. PROBABLY NOT USED !
            # ut_kills = math.ceil(ut_kills)

            # store result
            if ut_kills > 0:
                self.round_kills[ut] = { target : ut_kills }

    def calc_bonus_dmg(self, unit_base_dmg, ut: UnitType, vs: UnitType):
        """Calculate final damage with all skill bonuses and debuffs applied.
        
        Args:
            unit_base_dmg: Base damage before bonuses.
            ut: Attacking unit type.
            vs: Defending unit type.
            
        Returns:
            float: Final damage value after applying all offensive buffs,
                   defensive buffs, extra attacks, and dodge effects.
        """
        if BattleRound.DEBUG and self.round_idx % BattleRound.DEBUG_FREQ == 0 and self.round_idx < self.DEBUG_MAX_ROUND:
            print(f'\n🔸🔸🔸   {ut.name} / {vs.name}     ({self.fighter.name})')
        
        attack_effects_keys = ['DamageUp', 'OppDefenseDown']
        defense_effects_keys = ['DefenseUp', 'OppDamageDown']
        all_effects_keys = attack_effects_keys  + defense_effects_keys

        attacker_effects        = {key: {} for key in attack_effects_keys}
        defender_effects        = {key: {} for key in defense_effects_keys}
        only_normal_attacker    = {key: {} for key in attack_effects_keys}
        only_normal_defender    = {key: {} for key in defense_effects_keys}
        extra_attack_effects    = {key: {} for key in attack_effects_keys}
        
        # Track which skill+effect combinations have been applied to avoid value stacking
        # Key: (skill_name, effect_type, ben_op), Value: max_value
        applied_skill_effects = {}
        
        # Fighter benefits (attacker's offensive buffs)
        for benefit in self.round_benefits:
            benefit: Benefit
            if benefit.benefit_type not in attack_effects_keys: continue
            if not benefit.is_valid(ut, vs, self.round_idx): continue 
            ben_type = benefit.benefit_type
            ben_op = benefit.op
            ben_value = float(benefit.correct_value(self.round_idx))

            if benefit.extra_attack:
                effect_dict = extra_attack_effects[ben_type]
                if ben_op not in effect_dict: effect_dict[ben_op] = 0
                effect_dict[ben_op] += ben_value
                self.fighter.cumul_attacks[ut] += 1
                self.opponent.cumul_received_attacks[vs] += 1
                benefit._effect.extra_kills += unit_base_dmg * benefit.correct_value(self.round_idx) /100

            elif benefit.only_normal:
                effect_dict = only_normal_attacker[ben_type]
                if ben_op not in effect_dict: effect_dict[ben_op] = 0
                effect_dict[ben_op] += ben_value
            else:
                # For chance-based effects from same skill (like multiple Mias), use max value not sum
                skill_name = benefit._effect._skill.skill_name
                effect_key = (skill_name, ben_type, ben_op)
                effect_dict = attacker_effects[ben_type]
                
                if ben_op not in effect_dict:
                    effect_dict[ben_op] = 0
                
                if benefit._effect.is_chance and effect_key in applied_skill_effects:
                    # Same skill's chance-based effect already applied - take max, don't stack
                    applied_skill_effects[effect_key] = max(applied_skill_effects[effect_key], ben_value)
                    effect_dict[ben_op] = applied_skill_effects[effect_key]
                elif benefit._effect.is_chance:
                    # First time this skill's chance effect is applied
                    applied_skill_effects[effect_key] = ben_value
                    effect_dict[ben_op] = max(effect_dict[ben_op], ben_value)
                else:
                    # Non-chance effects stack normally
                    effect_dict[ben_op] += ben_value
            benefit.use()
            if BattleRound.DEBUG and self.round_idx % BattleRound.DEBUG_FREQ == 0 and self.round_idx < self.DEBUG_MAX_ROUND:
                print(f"           APPLIED: ", benefit)
                
        # Opponent benefits (defender's defensive buffs)
        dodging = 0
        for opp_benefit in self.opponent.rounds[self.round_idx].round_benefits:
            opp_benefit: Benefit
            if not opp_benefit.is_valid(vs, ut, self.round_idx): continue
            opp_ben_type = opp_benefit.benefit_type
            if 'dodge' in opp_ben_type.lower():
                dodging = max(1 if opp_benefit.only_normal else 2, dodging)
                opp_benefit.use()
                if BattleRound.DEBUG and self.round_idx % BattleRound.DEBUG_FREQ == 0 and self.round_idx < self.DEBUG_MAX_ROUND:
                    print(f"           OPP_DODGE: ", opp_benefit)
                continue

            if opp_ben_type not in defense_effects_keys: continue
            opp_ben_op = opp_benefit.op
            opp_ben_value = float(opp_benefit.correct_value(self.round_idx))
            
            # For chance-based effects from same skill (like multiple Mias), use max value not sum
            opp_skill_name = opp_benefit._effect._skill.skill_name
            opp_effect_key = (opp_skill_name, opp_ben_type, opp_ben_op)
            opp_effect_dict = defender_effects[opp_ben_type]
            
            if opp_ben_op not in opp_effect_dict:
                opp_effect_dict[opp_ben_op] = 0
            
            if opp_benefit._effect.is_chance and opp_effect_key in applied_skill_effects:
                # Same skill's chance-based effect already applied - take max, don't stack
                applied_skill_effects[opp_effect_key] = max(applied_skill_effects[opp_effect_key], opp_ben_value)
                opp_effect_dict[opp_ben_op] = applied_skill_effects[opp_effect_key]
            elif opp_benefit._effect.is_chance:
                # First time this skill's chance effect is applied
                applied_skill_effects[opp_effect_key] = opp_ben_value
                opp_effect_dict[opp_ben_op] = max(opp_effect_dict[opp_ben_op], opp_ben_value)
            else:
                # Non-chance effects stack normally
                opp_effect_dict[opp_ben_op] += opp_ben_value
            opp_benefit.use()

            if BattleRound.DEBUG and self.round_idx % BattleRound.DEBUG_FREQ == 0 and self.round_idx < self.DEBUG_MAX_ROUND:
                print(f"           OPP_APPLIED: ", opp_benefit)
        
        base = self.calc_coef(attacker_effects, defender_effects)
        normal_only = self.calc_coef(only_normal_attacker, only_normal_defender)
        extra = self.calc_coef(extra_attack_effects, {key: {} for key in defense_effects_keys})
        
        if dodging == 2:
            coef = 0
        elif dodging == 1:
            coef = base * (extra - 1)
        elif dodging == 0:
            coef = base * (extra + normal_only - 1)

        # coef = round(coef,4)
        
        self.round_dmg_coef[ut] = coef
        if dodging < 2:
            self.fighter.cumul_attacks[ut] += 1
            self.opponent.cumul_received_attacks[vs] += 1

        # DEBUG
        if BattleRound.DEBUG and self.round_idx % BattleRound.DEBUG_FREQ == 0 and self.round_idx < self.DEBUG_MAX_ROUND:
            print(f"\n           🔶 BONUS_COEF: R{self.round_idx} - {self.fighter.name} - {ut.name} / {vs.name} :    base:{base:.3f} - extra: {extra:.3f} - normal_only:{normal_only:.3f}  ---> 🔶 coef: {coef:.3f}")
        
        return unit_base_dmg * coef
    
    def calc_coef(self, attacker_dict, defender_dict):
        """Calculate damage coefficient from offensive and defensive effects.
        
        Args:
            attacker_dict: Dictionary of attacker's offensive effects by type and op.
            defender_dict: Dictionary of defender's defensive effects by type and op.
            
        Returns:
            float: Damage multiplier coefficient.
            
        Formula: (damageUp * oppDefenseDown) / (defenseUp * oppDamageDown)
        """
        damageUp = math.prod((1.0 + val / 100.0) for val in attacker_dict.get('DamageUp', {}).values())
        oppDefenseDown = math.prod((1.0 + val / 100.0) for val in attacker_dict.get('OppDefenseDown', {}).values())
        
        # Defender's defensive effects (reduce damage taken)
        defenseUp = math.prod((1.0 + val / 100.0) for val in defender_dict.get('DefenseUp', {}).values())
        oppDamageDown = math.prod((1.0 + val / 100.0) for val in defender_dict.get('OppDamageDown', {}).values())

        # DEBUG
        if BattleRound.DEBUG:
            pass
            # if self.round_idx % 5 == 0:
            #     print(f'------------------------------------- R{self.round_idx} - {self.fighter}')
            #     print('dmg_up:',damageUp)
            #     print('opp_dfs_down:',oppDefenseDown)
            #     print('dfs_up:', defenseUp)
            #     print('opp_dmg_down:', oppDamageDown)
    

        # if(damageUp != 1.0 or oppDefenseDown != 1.0 or defenseUp != 1.0 or oppDamageDown != 1.0):
        #     print('dmg_up:',damageUp)
        #     print('opp_dfs_down:',oppDefenseDown)
        #     print('dfs_up:', defenseUp)
        #     print('opp_dmg_down:', oppDamageDown)

        # Coefficient = (offensive buffs) / (defensive buffs)
        numerator = damageUp * oppDefenseDown
        denominator = defenseUp * oppDamageDown
        
        if denominator == 0 or denominator < 1e-10:
            print("⚠️  Warning: denominator too small, setting to large value to avoid division by zero.")
            coef = numerator * 1e10
        else:
            coef = numerator / denominator
        
        # if(coef != 1.0):
        #     print(coef)
        return coef


    def calc_round_army(self, ut: UnitType):
        """Calculate effective army size for a unit type.
        
        Args:
            ut: The unit type.
            
        Returns:
            int: Effective army size (square root formula).
            
        Uses game formula: sqrt(remaining_troops) * sqrt(min_army)
        """
        if ut not in self.round_troops: return 0
        army = (self.round_troops[ut] ** 0.5) * (self.army_min ** 0.5)

        ##### OR 
        # # army = (self.round_troops[ut] * self.army_min) ** 0.5
        ##### MORE LOGICAL WITH PYTHON FLOATS, BUT IT HAS BEEEN PROVEN LOGIC AND WOS ARE NOT FRIENDS

        army = math.ceil(army)
        return army
            
    def total_troops(self):
        """Calculate total remaining troops across all unit types.
        
        Returns:
            int: Sum of all remaining troops.
        """
        return sum(self.round_troops[ut] for ut in UnitType)
    
    def print_round_troops(self):
        """Format remaining troops for display.
        
        Returns:
            str: Formatted string showing troops by type.
        """
        return ' / '.join("{:6.0f}".format(round(self.round_troops[v],1)) for v in UnitType) 
    
    def print_round_coef(self):
        """Format damage coefficients for display.
        
        Returns:
            str: Formatted string showing coefficients by type.
        """
        return ' / '.join("{:6.2f}".format(round(self.round_dmg_coef[v],1)) for v in UnitType)
    
