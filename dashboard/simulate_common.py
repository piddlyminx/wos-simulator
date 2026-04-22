"""Shared simulator helpers for the dashboard's Python entrypoints."""

from __future__ import annotations

import os
import sys
from typing import Any, Dict

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from Base_classes.BattleRound import BattleRound
from Base_classes.Fight import Fight
from Base_classes.Fighter import Fighter
from Base_classes.JsonUtil import JsonUtil
from Base_classes.StatsBonus import StatsBonus


def canonical_hero_name(name: str) -> str:
    """Resolve a dashboard hero name (space-less) to the simulator registry key."""
    if name in JsonUtil.hero_registery:
        return name
    stripped = name.replace(" ", "")
    for canonical in JsonUtil.hero_registery:
        if canonical.replace(" ", "") == stripped:
            return canonical
    return name


def prepare_simulation_environment() -> None:
    """Load assets and apply the dashboard-only rally patch exactly once."""
    os.chdir(REPO_ROOT)

    if not getattr(JsonUtil, "_dashboard_assets_loaded", False):
        JsonUtil.load_fighters_data(
            fighters_stats_path="fighters_data/fighters_stats.json",
            fighters_heroes_path="fighters_data/fighters_heroes.json",
        )
        JsonUtil._dashboard_assets_loaded = True

    BattleRound.DEBUG = False
    BattleRound.dont_save = True

    if getattr(Fighter, "_dashboard_rally_patch_applied", False):
        return

    original_apply = Fighter._apply_prebattle_stat_bonuses

    def _patched_apply(self) -> None:  # type: ignore[override]
        rally = getattr(self, "rally_mode", False)
        role_self = getattr(self, "role", None)
        if rally and role_self == "attack":
            for idx, (skill, effect_dict) in enumerate(self.stat_bonus_effects):
                special = effect_dict.get("special", {}) or {}
                if special.get("role") == "rally":
                    patched_special = dict(special)
                    patched_special["role"] = "attack"
                    patched_effect = dict(effect_dict)
                    patched_effect["special"] = patched_special
                    self.stat_bonus_effects[idx] = (skill, patched_effect)
        return original_apply(self)

    Fighter._apply_prebattle_stat_bonuses = _patched_apply
    Fighter._dashboard_rally_patch_applied = True


def build_fighter(role_name: str, cfg: Dict[str, Any], rally_mode: bool) -> Fighter:
    fighter = Fighter(role_name, load_fighter_data=False)
    fighter.rally_mode = rally_mode

    stats_cfg = cfg.get("stats", {}) or {}
    stats_list = {
        "inf": stats_cfg.get("inf", [0.0, 0.0, 0.0, 0.0]),
        "lanc": stats_cfg.get("lanc", [0.0, 0.0, 0.0, 0.0]),
        "mark": stats_cfg.get("mark", [0.0, 0.0, 0.0, 0.0]),
    }
    fighter.stats = StatsBonus.from_list(stats_list)

    troops: Dict[str, int] = {}
    counts = cfg.get("troops", {}) or {}
    troop_types = cfg.get("troop_types", {}) or {}
    for cat in ("infantry", "lancer", "marksman"):
        count = int(counts.get(cat, 0) or 0)
        troop_key = troop_types.get(cat)
        if count > 0 and troop_key:
            troops[troop_key] = count
    fighter.troops = troops

    heroes_dict: Dict[str, Dict[str, int]] = {}
    heroes_cfg = cfg.get("heroes", {}) or {}
    for cat in ("infantry", "lancer", "marksman"):
        slot = heroes_cfg.get(cat) or {}
        name = slot.get("name")
        skills = slot.get("skills") or [0, 0, 0, 0]
        if not name:
            continue
        canonical = canonical_hero_name(name)
        registry = JsonUtil.hero_registery.get(canonical)
        if not registry:
            continue
        levels: Dict[str, int] = {}
        for skill in registry:
            num = skill.get("skill_num")
            if not isinstance(num, int) or num < 1 or num > 4:
                continue
            if num == 4 and not rally_mode:
                continue
            level = int(skills[num - 1]) if num - 1 < len(skills) else 0
            if level > 0:
                levels[f"skill_{num}"] = level
        if levels:
            heroes_dict[canonical] = levels
    fighter.heroes = heroes_dict

    joiner_names = []
    if rally_mode:
        for joiner in cfg.get("joiners") or []:
            joiner_name = (joiner or {}).get("name")
            if not joiner_name:
                continue
            canonical = canonical_hero_name(joiner_name)
            if canonical in JsonUtil.hero_registery:
                joiner_names.append(canonical)
    fighter.joiner_heroes = joiner_names[:4]

    return fighter


def outcome_from_remaining(attacker_remaining: int, defender_remaining: int) -> int:
    """Convert final survivors into the dashboard's signed outcome convention."""
    if attacker_remaining > 0 and defender_remaining == 0:
        return int(attacker_remaining)
    if defender_remaining > 0 and attacker_remaining == 0:
        return -int(defender_remaining)
    return int(attacker_remaining - defender_remaining)


def run_fight(attacker_cfg: Dict[str, Any], defender_cfg: Dict[str, Any], rally_mode: bool):
    attacker = build_fighter("attacker", attacker_cfg, rally_mode)
    defender = build_fighter("defender", defender_cfg, rally_mode)
    fight = Fight(attacker, defender, max_round=1500, dont_save=True)
    attacker_remaining, defender_remaining = fight.battle()
    return attacker, defender, int(attacker_remaining), int(defender_remaining)


def fight_once(attacker_cfg: Dict[str, Any], defender_cfg: Dict[str, Any], rally_mode: bool) -> Dict[str, int]:
    _, _, attacker_remaining, defender_remaining = run_fight(
        attacker_cfg,
        defender_cfg,
        rally_mode,
    )
    return {
        "attacker_remaining": attacker_remaining,
        "defender_remaining": defender_remaining,
        "outcome": outcome_from_remaining(attacker_remaining, defender_remaining),
    }
