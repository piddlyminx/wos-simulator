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
import random
import statistics
import sys
from typing import Any, Dict, List, Optional

from simulate_common import (
    prepare_simulation_environment,
    run_fight,
)

UNIT_KEYS = ("inf", "lanc", "mark")
UNIT_LABELS = {"inf": "Infantry", "lanc": "Lancers", "mark": "Marksmen"}


def _unit_key(unit: Any) -> str:
    name = getattr(unit, "name", str(unit))
    return {"inf": "inf", "lanc": "lanc", "mark": "mark"}.get(name, name)


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


def _effect_skill_name(effect: Any) -> str:
    return str(
        getattr(getattr(effect, "_skill", None), "skill_name", None)
        or getattr(effect, "name", "unknown")
    )


def _effect_owner(effect: Any) -> str:
    skill = getattr(effect, "_skill", None)
    return str(getattr(skill, "skill_hero", None) or getattr(skill, "skill_troop_type", None) or "Troop")


def _benefit_payload(benefit: Any) -> Dict[str, Any]:
    effect = getattr(benefit, "_effect", None)
    skill = getattr(effect, "_skill", None)
    return {
        "id": str(getattr(benefit, "id", "")),
        "hero": _effect_owner(effect),
        "skill_name": _effect_skill_name(effect),
        "effect_name": str(getattr(effect, "name", "unknown")),
        "effect_type": str(getattr(effect, "type", "")),
        "benefit_on": str(getattr(benefit, "benefit_on", "")),
        "extra_attack": bool(getattr(benefit, "extra_attack", False)),
        "used": bool(getattr(benefit, "used", False)),
        "uses_count": int(getattr(effect, "uses_count", 0) or 0),
        "trigger_count": int(getattr(effect, "trigger_count", 0) or 0),
        "value": float(getattr(benefit, "value", 0) or 0),
        "for_units": [_unit_key(unit) for unit in getattr(benefit, "for_units", [])],
        "vs_units": [_unit_key(unit) for unit in getattr(benefit, "vs_units", [])],
    }


def _empty_unit_map() -> Dict[str, float]:
    return {key: 0.0 for key in UNIT_KEYS}


def _troops_payload(round_obj: Any) -> Dict[str, int]:
    return {
        _unit_key(unit): int(round(value))
        for unit, value in getattr(round_obj, "round_troops", {}).items()
    }


def _kills_payload(round_obj: Any) -> Dict[str, Dict[str, float]]:
    kills = {key: _empty_unit_map() for key in UNIT_KEYS}
    for unit, targets in getattr(round_obj, "round_kills", {}).items():
        unit_key = _unit_key(unit)
        if unit_key not in kills:
            continue
        for target, value in targets.items():
            target_key = _unit_key(target)
            if target_key in kills[unit_key]:
                kills[unit_key][target_key] += float(value or 0)
    return kills


def _collect_trace(fight: Any, attacker: Any, defender: Any, seed: int, outcome: int) -> Dict[str, Any]:
    rounds: List[Dict[str, Any]] = []
    for idx in range(max(0, int(getattr(fight, "num_rounds", 0) or 0))):
        att_round = attacker.rounds.get(idx)
        def_round = defender.rounds.get(idx)
        if att_round is None or def_round is None:
            continue
        rounds.append(
            {
                "round": idx + 1,
                "attacker": {
                    "troops": _troops_payload(att_round),
                    "kills": _kills_payload(att_round),
                    "effects": [_benefit_payload(b) for b in getattr(att_round, "round_benefits", [])],
                },
                "defender": {
                    "troops": _troops_payload(def_round),
                    "kills": _kills_payload(def_round),
                    "effects": [_benefit_payload(b) for b in getattr(def_round, "round_benefits", [])],
                },
            }
        )

    skill_kills: Dict[str, Dict[str, Dict[str, float]]] = {"attacker": {}, "defender": {}}
    effect_usage: Dict[str, Dict[str, Dict[str, float]]] = {"attacker": {}, "defender": {}}
    for side_name, fighter in (("attacker", attacker), ("defender", defender)):
        for effect in fighter.effects:
            hero = _effect_owner(effect)
            skill_name = _effect_skill_name(effect)
            extra_kills = _effect_kills(effect)
            skill_bucket = skill_kills[side_name].setdefault(hero, {})
            skill_bucket[skill_name] = skill_bucket.get(skill_name, 0.0) + extra_kills

            effect_bucket = effect_usage[side_name].setdefault(_unit_key(getattr(effect, "troop_type", "all")), {})
            effect_label = f"{skill_name} / {getattr(effect, 'name', 'effect')}"
            effect_bucket[effect_label] = effect_bucket.get(effect_label, 0.0) + float(getattr(effect, "uses_count", 0) or 0)

    total_kills = {
        "attacker": {key: _empty_unit_map() for key in UNIT_KEYS},
        "defender": {key: _empty_unit_map() for key in UNIT_KEYS},
    }
    for row in rounds:
        for side_name in ("attacker", "defender"):
            for unit_key, targets in row[side_name]["kills"].items():
                for target_key, value in targets.items():
                    total_kills[side_name][unit_key][target_key] += float(value or 0)

    return {
        "seed": seed,
        "outcome": outcome,
        "rounds": rounds,
        "skill_kills": skill_kills,
        "effect_usage": effect_usage,
        "total_kills": total_kills,
    }


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

    rally_mode = bool(config.get("rally_mode", False))
    trace_seed: Optional[int] = None
    if config.get("trace_seed") is not None:
        trace_seed = int(config.get("trace_seed"))
    prepare_simulation_environment()

    if trace_seed is not None:
        attacker_cfg = config.get("attacker", {}) or {}
        defender_cfg = config.get("defender", {}) or {}
        random.seed(trace_seed)
        attacker, defender, att_rem, def_rem, fight = run_fight(
            attacker_cfg,
            defender_cfg,
            rally_mode,
            return_fight=True,
        )
        outcome = att_rem if att_rem > 0 and def_rem == 0 else -def_rem if def_rem > 0 and att_rem == 0 else att_rem - def_rem
        json.dump(
            {
                "replicates": 1,
                "summary": {
                    "mean": outcome,
                    "std": 0.0,
                    "best": {"value": int(outcome), "winner": "attacker" if outcome > 0 else "defender" if outcome < 0 else "draw"},
                    "worst": {"value": int(outcome), "winner": "attacker" if outcome > 0 else "defender" if outcome < 0 else "draw"},
                    "attacker_win_rate": 1.0 if outcome > 0 else 0.0,
                    "avg_skill_activations": 0.0,
                    "avg_skill_kills": 0.0,
                    "avg_attacker_activations": 0.0,
                    "avg_defender_activations": 0.0,
                    "avg_attacker_kills": 0.0,
                    "avg_defender_kills": 0.0,
                },
                "outcomes": [int(outcome)],
                "outcome_runs": [{"outcome": int(outcome), "seed": trace_seed}],
                "per_side_skills": {
                    "attacker": [],
                    "defender": [],
                },
                "trace": _collect_trace(fight, attacker, defender, trace_seed, int(outcome)),
            },
            sys.stdout,
        )
        sys.stdout.write("\n")
        return 0

    outcomes = []
    outcome_runs = []
    total_att_activations = 0.0
    total_def_activations = 0.0
    total_att_kills = 0.0
    total_def_kills = 0.0
    att_skill_aggregate: Dict[str, Dict[str, float]] = {}
    def_skill_aggregate: Dict[str, Dict[str, float]] = {}
    attacker_wins = 0
    attacker_cfg = config.get("attacker", {}) or {}
    defender_cfg = config.get("defender", {}) or {}

    _progress_interval = max(1, replicates // 20)
    base_seed = int(config.get("seed") or random.randrange(1, 2**31 - 1))
    for _i in range(replicates):
        seed = base_seed + _i
        random.seed(seed)
        attacker, defender, att_rem, def_rem = run_fight(
            attacker_cfg,
            defender_cfg,
            rally_mode,
        )

        if att_rem > 0 and def_rem == 0:
            outcomes.append(int(att_rem))
            outcome_runs.append({"outcome": int(att_rem), "seed": seed})
            attacker_wins += 1
        elif def_rem > 0 and att_rem == 0:
            outcomes.append(-int(def_rem))
            outcome_runs.append({"outcome": -int(def_rem), "seed": seed})
        else:
            # Stalemate / both nonzero (capped at max_round) — treat signed by who has more.
            if att_rem >= def_rem:
                outcome = int(att_rem - def_rem)
                outcomes.append(outcome)
                outcome_runs.append({"outcome": outcome, "seed": seed})
                if att_rem > def_rem:
                    attacker_wins += 1
            else:
                outcome = -int(def_rem - att_rem)
                outcomes.append(outcome)
                outcome_runs.append({"outcome": outcome, "seed": seed})

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

        if (_i + 1) % _progress_interval == 0 or _i + 1 == replicates:
            print(json.dumps({"type": "progress", "done": _i + 1, "total": replicates}), file=sys.stderr, flush=True)

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
        "outcome_runs": outcome_runs,
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
