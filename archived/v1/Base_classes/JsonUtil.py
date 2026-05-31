import json
import os
from pathlib import Path

# This file lives at <repo>/archived/v1/Base_classes/JsonUtil.py.
# Resolve data from this file's location rather than the process cwd (the legacy
# code assumed it ran from the repo root). The v1 game assets use the legacy
# schema and live alongside this engine under archived/v1/assets/; fighter stat
# profiles are shared with the v3 tournament runner and live under shared/.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_ASSET_DIR = _REPO_ROOT / "archived" / "v1" / "assets"
_FIGHTERS_DIR = _REPO_ROOT / "shared" / "fighters_data"

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
    def _get_asset(file_name: str, ASSET_DIR = str(_ASSET_DIR)):
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
    hero_skills_dir_path = str(_ASSET_DIR / 'hero_skills')
    for file in os.listdir(hero_skills_dir_path):
        _hero_dict = _get_asset(file, ASSET_DIR= hero_skills_dir_path)
        _canonical = _hero_dict[0]['skill_hero']
        hero_registery[_canonical] = _hero_dict
        for _alias in _hero_dict[0].get('aliases', []):
            hero_alias_to_canonical[_alias] = _canonical
    
    fighters_stats_path = str(_FIGHTERS_DIR / 'fighters_stats.json')
    fighters_heroes_path = str(_FIGHTERS_DIR / 'fighters_heroes.json')
    hero_base_stats_path = str(_ASSET_DIR / 'hero_base_stats.json')
    fighter_stats = None
    fighter_heroes = None
    hero_base_stats = None

    @staticmethod
    def _normalize_hero_name(name):
        return ''.join(str(name).split())

    @classmethod
    def _resolve_hero_base_stats(cls, hero_name):
        """Resolve a hero's max base stats from the shared category file."""
        if not cls.hero_base_stats:
            return None

        normalized_name = cls._normalize_hero_name(hero_name)
        overrides = cls.hero_base_stats.get('hero_overrides', {}) or {}
        override_by_name = {
            cls._normalize_hero_name(name): value
            for name, value in overrides.items()
        }
        categories = cls.hero_base_stats.get('categories', {}) or {}
        for category in categories.values():
            heroes = category.get('heroes', []) or []
            normalized_heroes = {cls._normalize_hero_name(hero) for hero in heroes}
            if normalized_name not in normalized_heroes:
                continue
            stats = dict(category.get('stats', {}) or {})
            override = override_by_name.get(normalized_name, {}) or {}
            stats.update(override.get('stats', {}) or {})
            return stats
        return None

    @classmethod
    def _apply_hero_base_stats(cls):
        """Hydrate fighter_heroes['max'] from the shared hero base stats file."""
        if not cls.fighter_heroes or not cls.hero_base_stats:
            return
        max_heroes = cls.fighter_heroes.get('max', {}) or {}
        for hero_name, hero_config in max_heroes.items():
            stats = cls._resolve_hero_base_stats(hero_name)
            if stats is not None:
                hero_config['stats'] = stats

    @classmethod
    def load_fighters_data(
        cls,
        fighters_stats_path = fighters_stats_path,
        fighters_heroes_path = fighters_heroes_path,
        hero_base_stats_path = hero_base_stats_path
        ):
        """Load saved fighter configurations from JSON files.
        
        Args:
            fighters_stats_path (str, optional): Path to fighter stats JSON. Defaults to 'fighters_data/fighters_stats.json'.
            fighters_heroes_path (str, optional): Path to fighter heroes JSON. Defaults to 'fighters_data/fighters_heroes.json'.
            hero_base_stats_path (str, optional): Path to shared max hero base stats JSON.
        """
        
        with open(fighters_stats_path, 'r+') as f:
            cls.fighter_stats = _normalize_json_values(json.load(f))
        
        with open(fighters_heroes_path, 'r+') as f:
            cls.fighter_heroes = _normalize_json_values(json.load(f))

        with open(hero_base_stats_path, 'r') as f:
            cls.hero_base_stats = _normalize_json_values(json.load(f))
        cls._apply_hero_base_stats()

    # # Get asset by id
    # @staticmethod
    # def by_id(assets_json, key: str, val: str):
    #     for o in assets_json:
    #         v = o.get(key)
    #         if isinstance(v, str) and v == val or str(v) == val:
    #             return o
    #     return None
