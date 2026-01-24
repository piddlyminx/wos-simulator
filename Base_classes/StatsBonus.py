import json
from Base_classes.UnitType import UnitType, prettify

# from enum import Enum

# class UnitType(Enum):
#     inf = "INFANTRY"
#     lanc = "LANCERS"
#     mark = "MARKSMEN"

class Basic_stat_dict():
    """Container for the four basic combat statistics.
    
    Holds attack, defense, lethality, and health values for a unit type.
    
    Attributes:
        attack (float): Attack value.
        defense (float): Defense value.
        lethality (float): Lethality value.
        health (float): Health value.
        stat_list (list): Class attribute listing all four stat names.
    """

    stat_list = ["attack", "defense", "lethality", "health"]

    def __init__(self) -> None:
        self.attack  = None
        self.defense = None
        self.lethality = None
        self.health  = None
    
    def _from_dict(self, _dict):
        """Initialize stats from dictionary.
        
        Args:
            _dict (dict): Dictionary with 'attack', 'defense', 'lethality', 'health' keys.
        
        Returns:
            Basic_stat_dict: Self for method chaining.
        """
        self.attack  = _dict["attack"]
        self.defense = _dict["defense"]
        self.lethality = _dict["lethality"]
        self.health  = _dict["health"]
        return self
    
    def _from_list(self, _list) :
        """Initialize stats from list.
        
        Args:
            _list (list): List with 4 elements: [attack, defense, lethality, health].
        
        Returns:
            Basic_stat_dict: Self for method chaining.
        """
        self.attack    = _list[0]
        self.defense   = _list[1]
        self.lethality = _list[2]
        self.health    = _list[3]
        return self
    
    def __str__(self) -> str:
        return json.dumps({
            "attack" : self.attack,
            "defense" : self.defense,
            "lethality" : self.lethality,
            "health" : self.health,
        }, indent= 2)

    def __repr__(self) -> str:
        return f"Basic_stat_dict(attack={self.attack}, defense={self.defense}, lethality={self.lethality}, health={self.health})"
    

class StatsBonus():
    """Container for stat bonuses across all unit types.
    
    Maintains a Basic_stat_dict for each unit type (inf, lanc, mark),
    allowing stat modifications by unit type.
    
    Attributes:
        inf (Basic_stat_dict): Infantry stats.
        lanc (Basic_stat_dict): Lancer stats.
        mark (Basic_stat_dict): Marksman stats.
    """
    def __init__(self) -> None:
        for ut in UnitType :
            self.__setattr__(ut.name, Basic_stat_dict())
    
    @staticmethod
    def from_dict(_dict):
        """Create StatsBonus from nested dictionary.
        
        Args:
            _dict (dict): Dictionary with keys containing unit type names, values are stat dicts.
        
        Returns:
            StatsBonus: New StatsBonus instance initialized from dictionary.
        """
        _s = StatsBonus()
        for ut in UnitType :
            ut_name = [k for k in _dict.keys() if ut.name in k.lower()][0]
            _s.__setattr__(ut.name, Basic_stat_dict()._from_dict(_dict[ut_name]))
        return _s
    
    @staticmethod
    def from_list(_dict):
        """Create StatsBonus from nested dictionary with list values.
        
        Args:
            _dict (dict): Dictionary with keys containing unit type names, values are stat lists.
        
        Returns:
            StatsBonus: New StatsBonus instance initialized from dictionary.
        """
        _s = StatsBonus()
        for ut in UnitType :
            ut_name = [k for k in _dict.keys() if ut.name in k.lower()][0]
            _s.__setattr__(ut.name, Basic_stat_dict()._from_list(_dict[ut_name]))
        return _s
    
    def add_bonus(self, type: UnitType, stat: str, value: float):
        """Add a bonus value to a specific unit type's stat.
        
        Args:
            type (UnitType): Unit type to modify.
            stat (str): Stat name ('attack', 'defense', 'lethality', or 'health').
            value (float): Amount to add to the stat.
        """
        type_stats = self.__getattribute__(type.name)
        stat_value = type_stats.__getattribute__(stat.lower())
        type_stats.__setattr__(stat.lower(), round(stat_value + value,2))
        self.__setattr__(type.name, type_stats)

    def __str__(self) -> str:
        return json.dumps(self.to_json(), indent= 4)
    
    def to_json(self):
        return {ut.name: self.__getattribute__(ut.name).__repr__() for ut in UnitType}

# fighter_1_stats = StatsBonus()

# _stats_1 = {
#     "attack" : 12,
#     "defense" : 13,
#     "lethality" : 14,
#     "health" : 15,
# }

# fighter_1_stats.inf._from_dict(_stats_1)

# print(fighter_1_stats)

# print(fighter_1_stats)
# fighter_1_stats.inf._from_dict(_stats_1)
# print(fighter_1_stats.inf.attack)
# fighter_1_stats.inf.attack = 99
# print(fighter_1_stats.inf)
# print(fighter_1_stats)
