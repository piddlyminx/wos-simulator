from Base_classes.JsonUtil import JsonUtil

class Hero:
    """Represents a hero and manages hero skill level configuration.
    
    This class provides static methods to load hero data, validate hero selections,
    and retrieve hero skill levels from configuration dictionaries or stored fighter data.
    
    Attributes:
        registry (dict): Global hero registry loaded from JsonUtil containing all hero data.
    """
    registry = JsonUtil.hero_registery

    @staticmethod
    def get_heroes_skill_levels(_heroes_dict, fighter_name, _joiners = False):
        """Get skill levels for a collection of heroes, with validation.
        
        Validates hero selections (max 3 regular heroes or 4 joiners, no duplicates for regular heroes,
        no duplicate troop types for regular heroes), then retrieves skill level data for each hero.
        
        Args:
            _heroes_dict (dict or list): Dictionary mapping hero names to skill level configs, or list of hero names.
            fighter_name (str): Name of the fighter (used to look up default hero configurations).
            _joiners (bool, optional): If True, treats heroes as joiners (max 4, can duplicate, only skill_1).
                                       If False, treats as regular heroes (max 3, no duplicates). Defaults to False.
        
        Returns:
            dict or list: If _joiners is False, returns dict mapping hero names to skill level dicts.
                         If _joiners is True, returns list of dicts with 'hero' and 'levels' keys.
        
        Raises:
            SystemExit: If validation fails (too many heroes, hero not found, duplicate hero/type).
        """
        if _joiners :
            if len(_heroes_dict) > 4:
                print(f"⚠️  Error:  only use 4 joiners !")
                exit() 
        else:
            if len(_heroes_dict) > 3:
                print(f"⚠️  Error:  only use 3 heroes !")
                exit() 
        
        # For joiners, return a list to allow duplicates
        if _joiners:
            skills_levels_list = []
            for hero_n in _heroes_dict:
                hero = hero_n.lower().capitalize()
                if hero not in Hero.registry:
                    print(f"⚠️  Error:  Hero named '{hero}' not found !")
                    exit()
                levels = Hero._hero_skill_level(hero, fighter_name, {} if isinstance(_heroes_dict, list) else _heroes_dict[hero_n], _joiners)
                skills_levels_list.append({'hero': hero, 'levels': levels})
            return skills_levels_list
        
        # For regular heroes, use dict (no duplicates allowed)
        skills_levels_dict = {}
        types = []
        for hero_n in _heroes_dict:
            hero = hero_n.lower().capitalize()
            if hero not in Hero.registry:
                print(f"⚠️  Error:  Hero named '{hero}' not found !")
                exit()
            if hero in skills_levels_dict.keys():
                print(f"⚠️  Error:  Hero '{hero}' was used twice !")
                exit()
            _type = Hero.registry[hero][0]['skill_troop_type'].lower()[:4]
            if _type in types:
                print(f"⚠️  Error:  You used 2 heroes of same type: {_type} !")
                exit()
            types.append(_type)
            skills_levels_dict[hero] = Hero._hero_skill_level(hero, fighter_name, {} if isinstance(_heroes_dict, list) else _heroes_dict[hero_n], _joiners)
        return skills_levels_dict

    @staticmethod
    def _hero_skill_level(hero_name: str, fighter_name, hero_skill_levels: dict = None, _joiner = False):
        """Get skill levels for a single hero.
        
        Retrieves skill level configuration for one hero. If no explicit config is provided,
        attempts to load from stored fighter data, otherwise uses defaults.
        
        Args:
            hero_name (str): Name of the hero.
            fighter_name (str): Name of the fighter (used to look up stored configs).
            hero_skill_levels (dict, optional): Explicit skill level configuration. Defaults to None.
            _joiner (bool, optional): If True, hero is treated as a joiner (only skill_1). Defaults to False.
        
        Returns:
            dict: Dictionary mapping skill identifiers (e.g., 'skill_1') to skill levels (1-5).
        """
        if hero_skill_levels is None:
            hero_skill_levels = {}
        h_skill_nums = [s['skill_num'] for s in Hero.registry[hero_name]]
        if (not hero_skill_levels) and fighter_name and (fighter_name in JsonUtil.fighter_heroes):
            for hero in JsonUtil.fighter_heroes[fighter_name]:
                if hero.lower() in hero_name.lower():
                    if 'skill_levels' in JsonUtil.fighter_heroes[fighter_name][hero]: 
                        hero_skill_levels = JsonUtil.fighter_heroes[fighter_name][hero]['skill_levels']
        return Hero._get_levels(hero_skill_levels, h_skill_nums, hero_name, _joiner=_joiner)

    @staticmethod
    def _get_levels(hero_skill_levels, h_skill_nums, hero_name, _joiner):
        """Parse and validate hero skill level configuration.
        
        Converts skill level dictionary into standardized format, validating skill numbers
        and levels. For joiners, only includes skill_1.
        
        Args:
            hero_skill_levels (dict): Dictionary with keys like 'skill_1' and integer level values.
            h_skill_nums (list): List of valid skill numbers for this hero (e.g., [1, 2, 3]).
            hero_name (str): Name of the hero (for error messages).
            _joiner (bool): If True, only includes skill_1 in the result.
        
        Returns:
            dict: Dictionary mapping skill identifiers to levels, or default level 5 for all skills.
        
        Raises:
            SystemExit: If skill configuration is invalid (bad format, invalid skill number, etc.).
        """
        if not hero_skill_levels:
            return {"skill_1":5} if _joiner else {f"skill_{num}":5 for num in h_skill_nums}
        
        skill_levels = {}
        for s_num_str, s_level in hero_skill_levels.items():
            _num = s_num_str.split('_')[1]
            if (not _num.isdigit()) or int(_num) > 4 or int(_num) < 1 or (not isinstance(s_level, int)) or s_level < 0 or s_level > 5:
                print(f"⚠️  Error (for hero : {hero_name}): skill levels should specified in the format: 'skill_X' or 'skill_X_level' : Y ")
                print(f"                               X: skill number (1-4), Y: skill level (0-5 integers) ")
                exit()
            _num = int(_num)
            if _num not in h_skill_nums:
                print(f"⚠️  Error : hero '{hero_name}' doesn't have a 'skill_{_num}' !")
                exit()
            if _joiner and _num != 1: continue
            if s_level > 0: skill_levels[f"skill_{_num}"] = s_level
        return skill_levels

        
if __name__ == "__main__":
    # # heroes = {
    # #     "Jessie" : {
    # #         "skill_1_level": 5,
    # #         "skill_2_level": 4,
    # #     },
    # #     "Jasser" : {
    # #         "skill_1_level": 5,
    # #     },
    # #     "Zinman" : {
    # #         "skill_1_level": 5,
    # #         "skill_2_level": 4,
    # #     }
    # # }

    # # print(Hero.get_heroes_skill_levels(heroes))
    pass
