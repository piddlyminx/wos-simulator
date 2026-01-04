from Base_classes.UnitType import UnitType, _to_unitx

from random import random

# Cache all unit types to avoid repeated list comprehensions
ALL_UNIT_TYPES = list(UnitType)

class Skill:
    """Represents a troop or hero skill with activation conditions and effects.
    
    Skills can be permanent or temporary, with various activation conditions including
    probability checks, round frequency, and troop type requirements.
    
    Attributes:
        skill_name (str): Unique skill identifier.
        skill_type (str): Type of skill ('hero_skill' or 'troop_skill').
        skill_troop_type (str): Troop type this skill applies to.
        skill_permanent (bool): If True, skill activates once and lasts entire battle.
        skill_is_chance (bool): If True, skill has probability check.
        skill_probability (float): Activation probability (0-100).
        skill_round_stackable (bool): If True, skill can activate multiple times in same round.
        skill_order (int): Execution order relative to other skills.
        skill_type_relation (bool): If True, skill requires troop type to be present.
        skill_frequency (dict): Frequency configuration (first/last round, frequency type/value).
        skill_effects_data (list): Raw effect data dictionaries.
        skill_hero (str or None): Hero name if hero skill, None if troop skill.
        skill_level (str): Skill level ('1'-'5' for hero skills, '1' for troop skills).
        procs (dict): Cached random rolls for each round.
    """
    def __init__(self, skill_dict: dict, level: int = 0) -> None:
        """Initialize a skill from configuration dictionary.
        
        Args:
            skill_dict (dict): Complete skill configuration with all required fields.
            level (int, optional): Skill level for hero skills (1-5). Defaults to 0 (auto-detect).
        """
        self.skill_name = skill_dict['skill_name']
        self.skill_type = skill_dict['skill_type']
        self.skill_troop_type = skill_dict['skill_troop_type']
        self.skill_permanent = skill_dict['skill_permanent']
        self.skill_is_chance = skill_dict['skill_is_chance']
        self.skill_probability = skill_dict['skill_probability']
        self.skill_round_stackable = skill_dict['skill_round_stackable']
        self.skill_order = skill_dict['skill_order']
        self.skill_type_relation = skill_dict['skill_type_relation']        # The skill only activates if the skill_troop_type is still present in the battle
        self.skill_frequency = skill_dict['skill_frequency']
        self.skill_effects_data = skill_dict['skill_effects']

        self.skill_hero = skill_dict['skill_hero'] if skill_dict['skill_type'] == 'hero_skill' else None
        self.skill_level = str(level or (5 if skill_dict['skill_type'] == 'hero_skill' else 1))

        # trackers:
        self.procs = {}


    def r_skill_condition(self, fighter, _round):
        """Check if skill activation conditions are met for a given round.
        
        Evaluates all conditions: stackability, troop type presence, round frequency,
        first/last round limits, and probability rolls.
        
        Args:
            fighter (Fighter): Fighter attempting to activate this skill.
            _round (int): Current round number.
        
        Returns:
            bool: True if all conditions pass and skill should activate, False otherwise.
        """
        first_effect_special = self.skill_effects_data[0].get('special', {}) if self.skill_effects_data else {}
        expected_role = first_effect_special.get('role')
        if expected_role and getattr(fighter, "role", None) not in (None, expected_role):
            return False
        # Already active, unless stackable in the same round
        if _round > 0 and self.skill_round_stackable == False:
            for benefit in fighter.rounds[_round - 1].round_benefits:
                benefit:Benefit
                if (self.skill_name in benefit.id) and benefit.is_valid("any","any",_round):
                    return False

        # type-relation check : Skills that only work if their base_troop_type is still present in the battle
        if self.skill_type_relation and fighter.rounds[_round].round_troops[_to_unitx(self.skill_troop_type)] <= 0: 
            return False

        # Round conditions
        if not self.skill_permanent :
            # start round
            if 'skill_first_round' in self.skill_frequency and (_round + 1) < self.skill_frequency['skill_first_round'] : return False
            # last round
            if 'skill_last_round' in self.skill_frequency and (_round + 1) > self.skill_frequency['skill_last_round'] : return False
            # round frequency
            if self.skill_frequency['frequency_type'] in ['turn','round']:
                _start = 0 if 'skill_first_round' not in self.skill_frequency else min(self.skill_frequency['skill_first_round'] - 1,0)
                if (_round - _start) % self.skill_frequency['frequency_value'] != 0 : return False
            # chance
            if self.skill_is_chance :
                if not self.proc(_round): return False # do not return self.proc(_round), more checks could be added later 
        return True
    
    def proc(self, _round):
        """Generate cached random roll for a round to determine skill activation.
        
        Caches random values per round to ensure consistent activation checks.
        
        Args:
            _round (int): Round number to generate random roll for.
        
        Returns:
            float: Random value between 0 and 1 for this round.
        """
        if _round not in self.procs: 
            r = random()
            self.procs[_round] = r
        return self.procs[_round] < self.skill_probability / 100.0

class Effect():
    """Represents a single effect produced by a skill.
    
    Effects define what happens when a skill activates: who can trigger it, who it affects,
    what benefit it provides, and how it stacks with other effects. Effects can have additional
    chance checks and duration limits.
    
    Attributes:
        name (str): Effect identifier.
        affects_opponent (bool): If True, effect targets opponent; if False, targets own side.
        extra_attack (bool): If True, effect triggers an additional attack.
        trig_for_unit (str): Which unit types can trigger this effect ('all', 'once', 'inf', 'mark', 'lanc').
        trig_vs_unit (str): Which enemy unit types this can trigger against ('all', 'inf', 'mark', 'lanc').
        ben_for_unit (str): Which friendly unit types receive the benefit ('all', 'trigger', 'inf', etc.).
        ben_vs_unit (str): Which enemy unit types the benefit applies against ('all', 'target', 'inf', etc.).
        type (str): Effect type (e.g., 'damage_up', 'defense_up', 'dodge').
        op (int): Operation code controlling stacking behavior with other effects.
        duration (dict): Duration configuration.
        is_chance (bool): If True, effect has additional probability check.
        probability (float): Activation probability if is_chance is True.
        value (float): Base effect value (percentage or fixed amount).
        trigger_count (int): Number of times this effect has been triggered.
        activations_count (int): Number of times effect activated in a round.
        uses_count (int): Total number of times benefit was applied.
        extra_kills (float): Total extra kills from this effect.
    """
    def __init__(self, skill:Skill, effect_dict):
        """Initialize an effect from configuration dictionary.
        
        Args:
            skill (Skill): Parent skill object this effect belongs to.
            effect_dict (dict): Effect configuration containing effect_num, trigger conditions,
                               benefit conditions, effect_type, effect_op, duration, and values.
        """
        self._skill = skill
        self.name = effect_dict['effect_num']
        self.affects_opponent = effect_dict['affects_opponent']
        self.extra_attack = effect_dict['extra_attack']

        self.trig_for_unit = effect_dict['trigger_types']['trigger_for']
        # trig_for_unit values: All, once (only once per turn), inf, mark, lanc
        self.trig_vs_unit = effect_dict['trigger_types']['trigger_vs']  
        # trig_vs_unit values: All, inf, mark, lanc
        self.ben_for_unit = effect_dict['benefit_types']['benefit_for'] 
        # ben_for_unit values: All, friendly, trigger (benefit only applies to unit who triggered it), inf, lanc, mark
        self.ben_vs_unit = effect_dict['benefit_types']['benefit_vs']   
        # ben_vs_unit values: All, target (benefit only applies to unit aginst whom it was triggered), inf, lanc, mark

        self.type = effect_dict['effect_type']
        self.op = effect_dict['effect_op']
        self.duration = effect_dict['effect_duration']
        # # self.unit_stackable = effect_dict['effect_unit_stackable']      # DEPRECATED: Replaced by using 'once' for trig_for_units
        self.is_chance = effect_dict['effect_is_chance']
        self.special = effect_dict['special']

        self.level = skill.skill_level
        self.troop_type = skill.skill_troop_type
        self.is_permanent = skill.skill_permanent
        self.frequency = skill.skill_frequency
        if self.is_chance:
            self.probability = effect_dict['effect_probabilities'][self.level]
        if self.type.lower() in ['dodge']:
            self.value = 0
        else:
            self.value = effect_dict['effect_values'][self.level]

        self.last_round = None
        self.trigger_count = 0
        self.activations_count = 0
        self.uses_count = 0
        self.extra_kills = 0
    
    def r_effect_condition(self, fighter, opponent, _round):
        """Check if effect can be applied in the current battle state.
        
        Validates that required unit types are still present in battle.
        
        Args:
            fighter (Fighter): Fighter that owns this effect.
            opponent (Fighter): Opposing fighter.
            _round (int): Current round number.
        
        Returns:
            bool: True if effect conditions are met, False otherwise.
        """
        # print(f'R{_round} ------ checking condition for effect {self.name}')
        # check if for_unit still present in battle
        if self.trig_for_unit not in  ["all", "once", "first"]:
            r_troops = fighter.rounds[_round].round_troops
            if self.trig_for_unit != "friendly":
                # print(f'R{_round} ------ FALSE: friendly')
                if r_troops[_to_unitx(self.trig_for_unit)] <= 0: return False
            else:
                if not any((r_troops[_type] > 0) for _type in UnitType if _type != _to_unitx(self.trig_for_unit) ): return False

        # check if opponent vs_unit still present in battle
        if self.trig_vs_unit != "all":
            if opponent.rounds[_round].round_troops[_to_unitx(self.trig_vs_unit)] <= 0 : return False
        
        return True
    
    def get_report(self):
        """Generate formatted report string for this effect.
        
        Returns:
            str: Report string with skill name, level, trigger count, uses count, extra kills, and type.
        """
        skill_name = f"{self._skill.skill_hero or self._skill.skill_troop_type.upper()}- {self.name} (Lvl {self.level})"
        skill_data = f"{self.trigger_count} ({self.uses_count}){f' -Extra: {self.extra_kills:.1f}' if self.extra_kills else ''}"
        skill_type = f"({self.type})"
        return f"{skill_name}{' '* max(0,40-len(skill_name))}:  {skill_data}{' '*max(0,20-len(skill_data))} {skill_type}"


class RoundEffect:
    """Represents an effect instance active in a specific round.
    
    RoundEffect wraps an Effect to track its activation state within a single round,
    including whether it's already been attempted or activated to prevent duplicate triggers.
    
    Attributes:
        r_eff_id (str): Unique identifier for this round effect (round_idx + effect name).
        round_idx (int): Round number this effect instance is active in.
        activated_in_round (bool): True if effect has activated in this round.
        attempted_in_round (bool): True if effect has been attempted in this round.
    """
    def __init__(self, effect: Effect, round_idx: int):
        """Initialize a round-specific effect instance.
        
        Args:
            effect (Effect): The effect to activate in this round.
            round_idx (int): The round number.
        """
        self._effect = effect
        self.round_idx = round_idx
        self.r_eff_id = f"{round_idx}_{effect.name}"

        self.activated_in_round = False
        self.attempted_in_round = False
        # self.remaining_duration = effect.duration
        # self._need_continue = False #(self.remaining_duration > 1) or _skill.skill_permanent

    def trigger_condition(self, fighter, opponent, ut, vs, _round):
        """Check if effect can trigger for a specific unit-vs-unit interaction.
        
        Evaluates all trigger conditions including unit type matching, attack frequency,
        already-activated checks, and probability rolls.
        
        Args:
            fighter (Fighter): Fighter that owns this effect.
            opponent (Fighter): Opposing fighter.
            ut (UnitType): Unit type attempting to trigger this effect.
            vs (UnitType): Enemy unit type being targeted.
            _round (int): Current round number.
        
        Returns:
            bool: True if all trigger conditions pass, False otherwise.
        """
        # Already attempted
        if self.attempted_in_round and (self._effect.trig_for_unit == 'first'): return False
        self.attempted_in_round = True
        # Already activated in round for unit, unless stackable in the same round
        if self.activated_in_round and (self._effect.trig_for_unit == 'once'): return False
        # attack frequency
        if (not self._effect.is_permanent) and ('attack' in self._effect.frequency['frequency_type']):
            if fighter.cumul_attacks[ut] % self._effect.frequency['frequency_value'] != 0 : return False
        
        # check if could be triggered by unit
        if self._effect.trig_for_unit == "friendly":
            if _to_unitx(self._effect.troop_type) == ut : return False
        elif self._effect.trig_for_unit not in ["all", "once", "first"]:
            if _to_unitx(self._effect.troop_type) != ut : return False
        # check if could be triggered against enemy unit
        if self._effect.trig_vs_unit != "all":
            if _to_unitx(self._effect.trig_vs_unit) != vs : return False
    
        # chance
        if self._effect.is_chance :
            r = random()
            if ( r >= self._effect.probability/100.0): 
                return False
        
        return True
    
    def activate_effect(self, fighter, ut, vs):
        """Activate this effect and create a benefit from it.
        
        Args:
            fighter (Fighter): Fighter that owns this effect.
            ut (UnitType): Unit type that triggered the effect.
            vs (UnitType): Enemy unit type targeted.
        
        Returns:
            Benefit: New benefit object created from this effect activation.
        """
        self.activated_in_round = True

        if self._effect.is_permanent: self._effect.trigger_count = 1
        else: self._effect.trigger_count += 1

        return Benefit(self, fighter, ut, vs)

class Benefit:
    """Represents an active buff/debuff benefit applied to units.
    
    Benefits are created when effects activate and persist for their duration,
    modifying combat calculations. They track which unit types they apply to,
    duration/lag, and can evolve over time.
    
    Attributes:
        id (str): Unique benefit identifier.
        fighter (Fighter): Fighter that owns this benefit.
        duration (int): Number of turns/attacks this benefit lasts (-1 for permanent).
        duration_type (str): Type of duration ('turn', 'round', 'attack').
        lag (int): Number of turns/attacks before benefit takes effect.
        benefit_type (str): Type of benefit (e.g., 'damage_up', 'defense_up').
        op (str): Operation code for stacking behavior.
        value (float): Base benefit value.
        for_units (list): List of unit types this benefit applies to.
        vs_units (list): List of enemy unit types this benefit applies against.
        start_round (int): Round number when benefit was created.
        attack_counter (int): Number of attacks this benefit has been used for.
        used (bool): True if benefit was used in current calculation.
    """
    def __init__(self, roundEff: RoundEffect, fighter, ut: UnitType, vs: UnitType):
        """Initialize a benefit from a round effect activation.
        
        Args:
            roundEff (RoundEffect): Round effect that created this benefit.
            fighter (Fighter): Fighter this benefit applies to.
            ut (UnitType): Unit type that triggered the effect.
            vs (UnitType): Enemy unit type targeted.
        
        Raises:
            ValueError: If ben_for_unit or ben_vs_unit configuration is invalid.
        """

        self.fighter = fighter
        self.id = roundEff.r_eff_id + '_' + str(roundEff.round_idx) + '_' + ut.value

        self.duration = roundEff._effect.duration['duration_value']
        self.duration_type = roundEff._effect.duration['duration_type']
        self.lag = roundEff._effect.duration['effect_lag']

        self.benefit_type = roundEff._effect.type
        self.op = str(roundEff._effect.op)
        self.value = roundEff._effect.value
        self.extra_attack = roundEff._effect.extra_attack

        self.only_normal = False
        if 'only_normal' in roundEff._effect.special:
            self.only_normal = True

        # for_units : Unit types the benefit applies for        
        if roundEff._effect.ben_for_unit == 'trigger':
            self.for_units = [ut]
        elif roundEff._effect.ben_for_unit == 'all':
            self.for_units = ALL_UNIT_TYPES.copy()
        elif roundEff._effect.ben_for_unit == 'friendly':
            self.for_units = [_ut for _ut in UnitType if _ut != _to_unitx(roundEff._effect.troop_type)]
        elif _to_unitx(roundEff._effect.ben_for_unit) in UnitType.list():
            self.for_units = [_to_unitx(roundEff._effect.ben_for_unit)]
        else:
            raise ValueError(f"Unknown value for ben_for_units ({roundEff._effect.ben_for_unit}) for hero '{roundEff._effect._skill.skill_hero}' effect '{roundEff.r_eff_id}' ")

        # vs_units : Unit types the benefit applies against
        if roundEff._effect.ben_vs_unit == 'target':
            self.vs_units = [vs]
        elif roundEff._effect.ben_vs_unit == 'all':
            self.vs_units = ALL_UNIT_TYPES.copy()
        elif _to_unitx(roundEff._effect.ben_vs_unit) in UnitType.list():
            self.vs_units = [_to_unitx(roundEff._effect.ben_vs_unit)]
        else:
            raise ValueError(f"Unknown value for ben_for_units ({roundEff._effect.ben_vs_unit}) for hero '{roundEff._effect._skill.skill_hero}' effect '{roundEff.r_eff_id}' ")
        
        self._effect = roundEff._effect
        self.start_round = roundEff.round_idx
        self.attack_counter = 0
        self.used = False

    def is_valid(self, ut, vs, _round, extra_attack = False):
        """Check if benefit is valid for a given unit interaction at current time.
        
        Args:
            ut (str or UnitType): Unit type to check, or 'any' to skip unit type check.
            vs (str or UnitType): Enemy unit type to check, or 'any' to skip.
            _round (int): Current round number.
            extra_attack (bool, optional): If True, this is an extra attack. Defaults to False.
        
        Returns:
            bool: True if benefit is valid and active, False otherwise.
        """
        if ut != "any" and ut not in self.for_units: return False
        if vs != "any" and vs not in self.vs_units: return False
        if extra_attack and self.only_normal: return False
        if self.duration_type in ['turn', 'round', 'turns', 'rounds'] and self.duration != -1:
            if (_round - self.start_round) < self.lag: return False
            if (_round - self.start_round - self.lag) >= self.duration: return False
        if 'attack' in self.duration_type:
            if self.attack_counter < self.lag: return False
            if (self.attack_counter - self.lag) >= self.duration: return False
        return True
    
    def use(self):
        """Mark benefit as used and increment counters.
        
        Should be called when benefit is applied to a combat calculation.
        """
        self.used = True
        self._effect.uses_count += 1
        self.attack_counter += 1

    def correct_value(self, round_idx):
        """Calculate current benefit value accounting for evolution effects.
        
        Some benefits evolve over time, decreasing with each attack or round.
        
        Args:
            round_idx (int): Current round number.
        
        Returns:
            float: Corrected benefit value for current time.
        """
        if 'effect_evolution' not in self._effect.special: return self.value
        correct_value = self.value

        evo_category = self._effect.special['effect_evolution']["category"]
        if evo_category == 'effect_is_total_damage' : 
            correct_value -= 100
        elif evo_category == 'effect_decrease':
            evo_data = self._effect.special['effect_evolution']["data"]
            if evo_data['type'] == "pct_value_fixed_decrease":
                if evo_data['step'] == 'attack':
                    correct_value = max(self.value - self.attack_counter * evo_data['decrease_value'],0)
                if evo_data['step'] in ['round', 'turn']:
                    correct_value = max(self.value - (round_idx - self.start_round) * evo_data['decrease_value'],0)
            elif evo_data['type'] == "pct_value_pct_decrease":
                if evo_data['step'] == 'attack':
                    correct_value = self.value * (1 - self.attack_counter * evo_data['decrease_value']/100)
                if evo_data['step'] in ['round', 'turn']:
                    correct_value = max(self.value * (1 - (round_idx - self.start_round) * evo_data['decrease_value']),0)
        # To-do: Add more effect evolution types if needed
        elif evo_category == 'fixed_damage':
            pass
        elif evo_category == 'fixed_kills':
            pass
        return correct_value
    
    def __str__(self):
        """Return string representation of benefit for debugging.
        
        Returns:
            str: Formatted string with benefit details.
        """
        return f"{self._effect._skill.skill_hero}:{self.id} - {self.benefit_type} - Op: {self.op} - Value: {self.value} - Extra: {self.extra_attack} ; duration: {self.duration} {self.duration_type} - ut: {[u.name for u in self.for_units] if self.for_units else None} - vs: {[u.name for u in self.vs_units] if self.vs_units else None}"
        
