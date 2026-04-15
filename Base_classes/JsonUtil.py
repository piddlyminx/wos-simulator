import json
import os

def _normalize_json_values(value):
    """Recursively coerce numeric-like JSON string values into numbers."""
    if isinstance(value, dict):
        return {k: _normalize_json_values(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize_json_values(v) for v in value]
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return value
        try:
            number = float(stripped.replace(',', '.'))
        except ValueError:
            return value
        return int(number) if number.is_integer() else number
    return value

class JsonUtil:
    """Utility class for loading game assets and fighter configurations from JSON files.
    
    Provides centralized access to troop stats, troop skills, hero skills,
    and saved fighter configurations.
    
    Attributes:
        troop_stats (dict): Loaded troop statistics from assets/troop_stats.json.
        troop_skills (list): Loaded troop skills from assets/troop_skills.json.
        hero_registery (dict): Dictionary mapping hero names to their skill data.
        fighter_stats (dict): Loaded fighter stat configurations.
        fighter_heroes (dict): Loaded fighter hero configurations.
    """
    # Load JSON assets from assets directory
    @staticmethod
    def _get_asset(file_name: str, ASSET_DIR = "assets"):
        """Load a JSON asset file.
        
        Args:
            file_name (str): Name of the JSON file to load.
            ASSET_DIR (str, optional): Directory containing the asset. Defaults to 'assets'.
        
        Returns:
            dict or list: Parsed JSON data.
        """
        path = os.path.join(ASSET_DIR, file_name)
        with open(path, 'r', encoding='utf-8') as f:
            return _normalize_json_values(json.load(f))

    # Import assets
    troop_stats = _get_asset('troop_stats.json')
    troop_skills = _get_asset('troop_skills.json')
    # hero dicts
    hero_registery = {}
    hero_alias_to_canonical = {}  # maps alias names -> canonical hero name
    hero_skills_dir_path = 'assets/hero_skills/'
    for file in os.listdir(hero_skills_dir_path):
        _hero_dict = _get_asset(file, ASSET_DIR= hero_skills_dir_path)
        _canonical = _hero_dict[0]['skill_hero']
        hero_registery[_canonical] = _hero_dict
        for _alias in _hero_dict[0].get('aliases', []):
            hero_alias_to_canonical[_alias] = _canonical
    
    fighters_stats_path = 'fighters_data/fighters_stats.json',
    fighters_heroes_path = 'fighters_data/fighters_heroes.json'
    fighter_stats = None
    fighter_heroes = None

    @classmethod
    def load_fighters_data(
        cls,
        fighters_stats_path = fighters_stats_path,
        fighters_heroes_path = fighters_heroes_path
        ):
        """Load saved fighter configurations from JSON files.
        
        Args:
            fighters_stats_path (str, optional): Path to fighter stats JSON. Defaults to 'fighters_data/fighters_stats.json'.
            fighters_heroes_path (str, optional): Path to fighter heroes JSON. Defaults to 'fighters_data/fighters_heroes.json'.
        """
        
        with open(fighters_stats_path, 'r+') as f:
            cls.fighter_stats = _normalize_json_values(json.load(f))
        
        with open(fighters_heroes_path, 'r+') as f:
            cls.fighter_heroes = _normalize_json_values(json.load(f))

    # # Get asset by id
    # @staticmethod
    # def by_id(assets_json, key: str, val: str):
    #     for o in assets_json:
    #         v = o.get(key)
    #         if isinstance(v, str) and v == val or str(v) == val:
    #             return o
    #     return None
