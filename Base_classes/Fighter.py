from Base_classes.Skill import Skill, Effect
from Base_classes.StatsBonus import StatsBonus
from Base_classes.Hero import Hero
from Base_classes.UnitType import UnitType, _to_unitx
from Base_classes.JsonUtil import JsonUtil
import math, json

class Fighter:
    """Represents a fighter in the battle simulation.
    
    Manages fighter stats, troops, heroes, skills, and battle history.
    Calculates attack/defense values and tracks cumulative battle statistics.
    
    Attributes:
        name (str): Fighter name/identifier.
        stats (StatsBonus): Fighter's stat bonuses.
        troops (dict): Troop counts by troop name.
        heroes (dict): Active heroes and their skill levels.
        joiner_heroes (list): Joining heroes and their skill levels.
        skills (list): All active skill objects.
        effects (list): All active effect objects from skills.
        rounds (dict): BattleRound objects indexed by round number.
    """
    def __init__(self, name, load_fighter_data = True):
        """Initialize a fighter.
        
        Args:
            name: Fighter name/identifier.
            load_fighter_data: Whether to load stats from fighter data file.
        """

        self.load_fighter = load_fighter_data
        self.name = name
        self._troops = {}
        self.role = None
        self.stats = StatsBonus.from_list(JsonUtil.fighter_stats[self.name]) if self.load_fighter else StatsBonus()
        self._heroes = {}
        self._joiner_heroes = []
        
        self.skills = []
        self.effects = []

        self.attack_by_troop = {}
        self.defense_by_troop = {}

        self.troops_by_type = {}
        self.attack_by_type = {}
        self.defense_by_type = {}

        self.rounds = {}
        self.cumul_attacks = {ut:0 for ut in UnitType}
        self.cumul_received_attacks = {ut:0 for ut in UnitType}

    def add_heroes_stats(self):
        """Add hero stat bonuses to fighter stats.
        
        Loads hero stats from fighters_heroes.json and applies them to
        this fighter's stats. Use only if hero stats are not already
        included in fighter_stats.json.
        
        Raises:
            SystemExit: If fighter or hero not found in data file.
        """
        heroes_stats = JsonUtil.fighter_heroes
        if self.name not in heroes_stats:
            print(f"\n⚠️  fighter '{self.name}' not found in '{JsonUtil.fighters_heroes_path}' ")
            exit()
        for hero in self.heroes:
            _found = False
            for hero_n in heroes_stats[self.name]:
                if hero in hero_n.lower().capitalize() :
                    _found = True
                    h_type = _to_unitx(JsonUtil.hero_registery[hero][0]['skill_troop_type'])
                    h_stats = heroes_stats[self.name][hero_n]['stats']
                    for _stat, _value in h_stats.items():
                        self.stats.add_bonus(h_type, _stat, _value)
            if not _found:
                print(f"\n⚠️  '{hero}' stats not found in '{self.name}' data ({JsonUtil.fighters_heroes_path}) ")
                exit()

    def calc(self, opponent):
        """Calculate all fighter stats and prepare for battle.
        
        Args:
            opponent: The opponent Fighter object.
            
        Calculates skills, attack/defense values by troop and type.
        """
        self.calc_skills()
        for troop_name in self.troops:
            self.calc_by_troop(troop_name, opponent)
        self.calc_by_type()
    
    def calc_skills(self):
        """Calculate and initialize all active skills and effects.
        
        Processes hero skills, troop skills, and creates effect objects.
        """
        self._calc_hero_skills()
        self._calc_troops_skills()
        self._calc_effects()

    def calc_by_troop(self, troop_name, opponent):
        """Calculate attack and defense values for a specific troop type.
        
        Args:
            troop_name: Name of the troop type (e.g., 'infantry_t6').
            opponent: Opponent fighter (currently unused but kept for compatibility).
            
        Applies stat bonuses and calculates effective attack/defense values.
        """
        troop = JsonUtil.troop_stats[troop_name]
        base_attack = troop["stats"].get("Attack")
        base_lethality = troop["stats"].get("Lethality")
        base_health = troop["stats"].get("Health")
        base_defense = troop["stats"].get("Defense")
        troop_type = _to_unitx(troop_name)

        fighter_stats = self.stats.__getattribute__(troop_type.name)
        bonus_attack = fighter_stats.attack / 100
        bonus_lethality = fighter_stats.lethality / 100
        bonus_health = fighter_stats.health / 100
        bonus_defense = fighter_stats.defense / 100

        attack_ret = base_attack * (1 + bonus_attack) * base_lethality * (1 + bonus_lethality) / 100.0
        defense_ret = base_health * (1 + bonus_health) * base_defense * (1 + bonus_defense) / 100.0

        self.attack_by_troop[troop_name] = attack_ret
        self.defense_by_troop[troop_name] = defense_ret

    def calc_by_type(self):
        """Calculate weighted average attack/defense by unit type.
        
        Aggregates values from all troop tiers of each unit type
        (infantry, lancers, marksmen) into single values per type.
        """
        # Initialize all unit types to 0
        for ut in UnitType:
            self.troops_by_type[ut] = 0
            self.attack_by_type[ut] = 0
            self.defense_by_type[ut] = 0
        
        # To-Do: Verify that skills do indeed work like stamps
        for ut in UnitType:
            total_attack = 0.0
            total_defense = 0.0
            count = 0

            for troop_name in self.troops:
                if ut == _to_unitx(troop_name):
                    num = self.troops[troop_name]
                    total_attack += num * self.attack_by_troop[troop_name]
                    total_defense += num * self.defense_by_troop[troop_name]
                    count += num
            
            # SOS Model: To confirm -> seems wrong from tests
            # attack = 0.0
            # defense = 0.0
            # if total_attack > 0 and total_defense > 0:
            #     attack = 1.0
            #     defense = 1.0
            #     for troop_name in self.troops:
            #         if ut == _to_unitx(troop_name):
            #             num = self.troops[troop_name]
            #             atk = self.attack_by_troop[troop_name]
            #             defn = self.defense_by_troop[troop_name]
            #             attack *= math.pow(atk, num * atk / total_attack)
            #             defense *= math.pow(defn, num * defn / total_defense)

            # self.attack_by_type[ut] = attack
            # self.defense_by_type[ut] = defense
            # self.troops_by_type[ut] = count

            
            # Arithmetic mean - still has error but below 1% in the tests I've done
            if count > 0:
                self.attack_by_type[ut] = total_attack / count
                self.defense_by_type[ut] = total_defense / count
                self.troops_by_type[ut] = count
            
    def _calc_hero_skills(self):
        """Process and initialize all hero skills.
        
        Creates Skill objects for main heroes and joiner heroes.
        """
        heroes_registry = JsonUtil.hero_registery
        # Fighter heroes
        for hero, levels in self.heroes.items():
            for skill in heroes_registry[hero]:
                if f"skill_{skill['skill_num']}" in levels.keys():
                    self.skills.append(Skill(skill,level = levels[f"skill_{skill['skill_num']}"]))
        # Joiners heroes
        for hero_data in self.joiner_heroes:
            hero = hero_data['hero']
            levels = hero_data['levels']
            for skill in heroes_registry[hero]:
                key = f"skill_{skill['skill_num']}"
                if key in levels.keys():
                    self.skills.append(Skill(skill, level=levels[key]))

    def _calc_troops_skills(self):
        """Process and initialize all troop-based skills.
        
        Determines skill levels based on troop tier and creates Skill objects.
        """
        _troop_skills_data = JsonUtil.troop_skills
        for troop_skill in _troop_skills_data:
            level = 0
            for troop_name in self.troops:
                if _to_unitx(troop_name) == _to_unitx(troop_skill['skill_troop_type']):
                    troop = JsonUtil.troop_stats[troop_name]
                    for condition in troop_skill['skill_conditions']:
                        if troop[condition['condition_type']] >= condition['condition_value']:
                            level = max(level, int(condition['level']))
            if level:
                self.skills.append(Skill(troop_skill, level))

    def _calc_effects(self):
        """Create Effect objects from all skill effect data.
        
        Converts skill effects into Effect objects for battle processing.
        """
        for skill in self.skills:
            for _effect in skill.skill_effects_data:
                eff_type = _effect.get('effect_type')
                # Special handling for StatBonus-type widget effects:
                # apply a percentage modifier directly to this fighter's StatsBonus,
                # then do not add an Effect for runtime processing.
                if eff_type == "StatBonus":
                    special = _effect.get('special', {}) or {}
                    stat = special.get('stat')
                    role = special.get('role')
                    # Role-gated widgets: only apply when fighter is in the right role (attack/defense)
                    if role and getattr(self, "role", None) != role:
                        continue
                    if not stat:
                        continue
                    level_key = skill.skill_level
                    values = _effect.get('effect_values', {}) or {}
                    if level_key not in values:
                        continue
                    try:
                        pct = float(values[level_key])
                    except (TypeError, ValueError):
                        continue
                    # Apply as a percentage multiplier to the current stat for each unit type
                    for ut in UnitType:
                        type_stats = getattr(self.stats, ut.name)
                        base = getattr(type_stats, stat.lower(), None)
                        if base is None:
                            continue
                        delta = base * pct / 100.0
                        if delta:
                            self.stats.add_bonus(ut, stat, delta)
                    continue

                # All non-StatBonus effects go through the normal runtime Effect flow
                self.effects.append(Effect(skill, _effect))

    def get_sum_army(self, round = 0):
        """Get total army size at a specific round.
        
        Args:
            round: Round number (0 for initial army size).
            
        Returns:
            int: Total number of troops.
        """
        if round: return sum(math.ceil(v) for v in self.rounds[round].round_troops.values())
        return sum(self.troops_by_type.values())
    
    def get_skill_by_name(self, skill_name):
        """Find a skill by name.
        
        Args:
            skill_name: Name of the skill to find.
            
        Returns:
            Skill: The matching skill object, or None if not found.
        """
        for skill in self.skills:
            if skill.skill_name == skill_name: return skill
    
    def print_skills_list(self):
        """Print all active skills with their levels."""
        for skill in self.skills:
            print(f"{skill.skill_hero or 'TROOP SKILL:'} - {skill.skill_name} : Level {skill.skill_level}")

    @property
    def troops(self):
        return self._troops

    @troops.setter
    def troops(self, troop_dict):
        for troop_name in troop_dict:
            if troop_name not in JsonUtil.troop_stats:
                print(f"⚠️  Error : no data found for troop '{troop_name}' (P.S: FC6+ troops are not yet supported)")
                exit()
            if troop_dict[troop_name] > 0:
                self._troops[troop_name] = troop_dict[troop_name]

    @property
    def heroes(self):
        return self._heroes
    
    @heroes.setter
    def heroes(self, _dict):
        self._heroes = Hero.get_heroes_skill_levels(_dict, fighter_name = (self.name if self.load_fighter else None), _joiners= False)

    @property
    def joiner_heroes(self):
        return self._joiner_heroes
    
    @joiner_heroes.setter
    def joiner_heroes(self, _dict):
        self._joiner_heroes = Hero.get_heroes_skill_levels(_dict, fighter_name = None, _joiners= True)
