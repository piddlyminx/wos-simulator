"""Live battle simulator CLI for the dashboard's /simulate page.

Reads a JSON config from stdin, runs N replicates of the battle, and writes a
JSON summary to stdout. All console output goes to stderr so stdout stays
pure JSON for the NextJS route to consume.

Input JSON shape::

    {
      "attacker": {
        "troops": { "infantry": int, "lancer": int, "marksman": int },
        "troop_types": { "infantry": "infantry_t6", "lancer": "lancer_t6",
                         "marksman": "marksman_t6" },
        "heroes": {
          "infantry": { "name": "Logan" | null, "skills": [s1, s2, s3, s4] },
          "lancer":   { ... },
          "marksman": { ... }
        },
        "stats": {
          "inf":  [attack, defense, lethality, health],
          "lanc": [attack, defense, lethality, health],
          "mark": [attack, defense, lethality, health]
        }
      },
      "defender": { ...same shape... },
      "replicates": 100
    }

Output JSON::

    {
      "replicates": N,
      "summary": {
        "mean": float, "std": float,
        "best": {"value": int, "winner": "attacker"|"defender"},
        "worst": {"value": int, "winner": "attacker"|"defender"},
        "attacker_win_rate": float,  # 0..1
        "avg_skill_activations": float,
        "avg_skill_kills": float
      },
      "outcomes": [int, ...],  # signed survivor counts; +ve = attacker wins, -ve = defender wins
      "per_side_skills": {
         "attacker": [{"name": str, "avg_activations": float, "avg_kills": float}, ...],
         "defender": [...]
      }
    }
"""
from __future__ import annotations

import json
import math
import os
import statistics
import sys
from typing import Any, Dict

# Ensure we can import the simulator modules regardless of cwd. The Base_classes
# package lives at <repo-root>/Base_classes; this file is at <repo-root>/dashboard.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from Base_classes.Fight import Fight
from Base_classes.Fighter import Fighter
from Base_classes.StatsBonus import StatsBonus
from Base_classes.BattleRound import BattleRound
from Base_classes.JsonUtil import JsonUtil


def _build_fighter(role_name: str, cfg: Dict[str, Any]) -> Fighter:
    fighter = Fighter(role_name, load_fighter_data=False)

    stats_cfg = cfg.get("stats", {}) or {}
    stats_list = {
        "inf": stats_cfg.get("inf", [0.0, 0.0, 0.0, 0.0]),
        "lanc": stats_cfg.get("lanc", [0.0, 0.0, 0.0, 0.0]),
        "mark": stats_cfg.get("mark", [0.0, 0.0, 0.0, 0.0]),
    }
    fighter.stats = StatsBonus.from_list(stats_list)

    troops: Dict[str, int] = {}
    counts = cfg.get("troops", {}) or {}
    types = cfg.get("troop_types", {}) or {}
    for cat in ("infantry", "lancer", "marksman"):
        count = int(counts.get(cat, 0) or 0)
        key = types.get(cat)
        if count > 0 and key:
            troops[key] = count
    fighter.troops = troops

    heroes_dict: Dict[str, Dict[str, int]] = {}
    heroes_cfg = cfg.get("heroes", {}) or {}
    for cat in ("infantry", "lancer", "marksman"):
        slot = heroes_cfg.get(cat) or {}
        name = slot.get("name")
        skills = slot.get("skills") or [0, 0, 0, 0]
        if not name:
            continue
        registry = JsonUtil.hero_registery.get(name)
        if not registry:
            continue
        levels: Dict[str, int] = {}
        for skill in registry:
            num = skill.get("skill_num")
            if not isinstance(num, int):
                continue
            if num < 1 or num > 4:
                continue
            level = int(skills[num - 1]) if num - 1 < len(skills) else 0
            if level > 0:
                levels[f"skill_{num}"] = level
        if levels:
            heroes_dict[name] = levels
    fighter.heroes = heroes_dict
    fighter.joiner_heroes = []
    return fighter


def _effect_kills(effect: Any) -> float:
    for attr in ("extra_kills", "kills", "total_kills"):
        val = getattr(effect, attr, None)
        if val is None:
            continue
        try:
            return float(val)
        except (TypeError, ValueError):
            return 0.0
    return 0.0


def _collect_skill_stats(fighter: Fighter) -> Dict[str, Dict[str, float]]:
    """Aggregate activations + kills per skill name for one fighter for one battle."""
    by_skill: Dict[str, Dict[str, float]] = {}
    for effect in fighter.effects:
        trig = getattr(effect, "trigger_count", 0) or 0
        if not trig:
            continue
        skill_name = getattr(getattr(effect, "skill", None), "skill_name", None) or getattr(effect, "name", "unknown")
        bucket = by_skill.setdefault(str(skill_name), {"activations": 0.0, "kills": 0.0})
        bucket["activations"] += float(trig)
        bucket["kills"] += _effect_kills(effect)
    return by_skill


def main() -> int:
    raw = sys.stdin.read()
    try:
        config = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"Invalid JSON: {exc}", file=sys.stderr)
        return 2

    replicates = int(config.get("replicates", 100) or 100)
    if replicates < 1:
        replicates = 1
    if replicates > 1000:
        replicates = 1000

    # JsonUtil resolves troop/skill asset paths relative to cwd. Swap into the
    # repo root before loading so callers can run us from anywhere.
    os.chdir(_REPO_ROOT)
    stats_path = "fighters_data/fighters_stats.json"
    heroes_path = "fighters_data/fighters_heroes.json"
    JsonUtil.load_fighters_data(
        fighters_stats_path=stats_path,
        fighters_heroes_path=heroes_path,
    )

    BattleRound.DEBUG = False
    BattleRound.dont_save = True

    outcomes = []
    total_att_activations = 0.0
    total_def_activations = 0.0
    total_att_kills = 0.0
    total_def_kills = 0.0
    att_skill_aggregate: Dict[str, Dict[str, float]] = {}
    def_skill_aggregate: Dict[str, Dict[str, float]] = {}
    attacker_wins = 0

    for _ in range(replicates):
        attacker = _build_fighter("attacker", config.get("attacker", {}) or {})
        defender = _build_fighter("defender", config.get("defender", {}) or {})

        fight = Fight(attacker, defender, max_round=1500, dont_save=True)
        att_rem, def_rem = fight.battle()

        if att_rem > 0 and def_rem == 0:
            outcomes.append(int(att_rem))
            attacker_wins += 1
        elif def_rem > 0 and att_rem == 0:
            outcomes.append(-int(def_rem))
        else:
            # Stalemate / both nonzero (capped at max_round) — treat signed by who has more.
            if att_rem >= def_rem:
                outcomes.append(int(att_rem - def_rem))
                if att_rem > def_rem:
                    attacker_wins += 1
            else:
                outcomes.append(-int(def_rem - att_rem))

        for name, d in _collect_skill_stats(attacker).items():
            agg = att_skill_aggregate.setdefault(name, {"activations": 0.0, "kills": 0.0})
            agg["activations"] += d["activations"]
            agg["kills"] += d["kills"]
            total_att_activations += d["activations"]
            total_att_kills += d["kills"]
        for name, d in _collect_skill_stats(defender).items():
            agg = def_skill_aggregate.setdefault(name, {"activations": 0.0, "kills": 0.0})
            agg["activations"] += d["activations"]
            agg["kills"] += d["kills"]
            total_def_activations += d["activations"]
            total_def_kills += d["kills"]

    mean = statistics.mean(outcomes) if outcomes else 0.0
    std = statistics.pstdev(outcomes) if len(outcomes) > 1 else 0.0
    best = max(outcomes, key=lambda v: v) if outcomes else 0
    worst = min(outcomes, key=lambda v: v) if outcomes else 0

    def _winner(v: int) -> str:
        if v > 0:
            return "attacker"
        if v < 0:
            return "defender"
        return "draw"

    summary = {
        "mean": mean,
        "std": std,
        "best": {"value": int(best), "winner": _winner(best)},
        "worst": {"value": int(worst), "winner": _winner(worst)},
        "attacker_win_rate": attacker_wins / replicates if replicates else 0.0,
        "avg_skill_activations": (total_att_activations + total_def_activations) / replicates if replicates else 0.0,
        "avg_skill_kills": (total_att_kills + total_def_kills) / replicates if replicates else 0.0,
        "avg_attacker_activations": total_att_activations / replicates if replicates else 0.0,
        "avg_defender_activations": total_def_activations / replicates if replicates else 0.0,
        "avg_attacker_kills": total_att_kills / replicates if replicates else 0.0,
        "avg_defender_kills": total_def_kills / replicates if replicates else 0.0,
    }

    per_side_skills = {
        "attacker": [
            {
                "name": name,
                "avg_activations": data["activations"] / replicates,
                "avg_kills": data["kills"] / replicates,
            }
            for name, data in sorted(att_skill_aggregate.items())
        ],
        "defender": [
            {
                "name": name,
                "avg_activations": data["activations"] / replicates,
                "avg_kills": data["kills"] / replicates,
            }
            for name, data in sorted(def_skill_aggregate.items())
        ],
    }

    result = {
        "replicates": replicates,
        "summary": summary,
        "outcomes": outcomes,
        "per_side_skills": per_side_skills,
    }

    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    try:
        rc = main()
    except Exception as exc:  # surface errors cleanly to the Next route
        print(f"Simulator error: {exc}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        rc = 1
    sys.exit(rc)
