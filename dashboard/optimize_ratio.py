"""Search attacker troop compositions for the best win rate against a fixed defender."""

from __future__ import annotations

import copy
import json
import os
import statistics
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import Any, Dict, Iterable, Tuple

from simulate_common import fight_once, prepare_simulation_environment

MAX_COMPOSITIONS = 800
MAX_SIMULATIONS = 20000
DEFAULT_REPLICATES = 20
DEFAULT_TOP_RESULTS = 10
DEFAULT_MAX_WORKERS = max(1, min(6, (os.cpu_count() or 2) - 1))

_WORKER_ATTACKER_CFG: Dict[str, Any] | None = None
_WORKER_DEFENDER_CFG: Dict[str, Any] | None = None
_WORKER_RALLY_MODE = False
_WORKER_REPLICATES = DEFAULT_REPLICATES


def _recommended_step(total: int) -> int:
    if total <= 0:
        return 1
    return max(1, int(round(total / 30)))


def _composition_grid(total: int, step: int) -> Iterable[Tuple[int, int, int]]:
    for infantry in range(0, total + 1, step):
        remaining = total - infantry
        for lancer in range(0, remaining + 1, step):
            marksman = total - infantry - lancer
            yield infantry, lancer, marksman


def _composition_count(total: int, step: int) -> int:
    count = 0
    for infantry in range(0, total + 1, step):
        remaining = total - infantry
        count += remaining // step + 1
    return count


def _normalise_step(total: int, raw_step: Any) -> int:
    try:
        step = int(raw_step or 0)
    except (TypeError, ValueError):
        step = 0
    if step <= 0:
        step = _recommended_step(total)
    return max(1, step)


def _normalise_replicates(raw_value: Any) -> int:
    try:
        replicates = int(raw_value or DEFAULT_REPLICATES)
    except (TypeError, ValueError):
        replicates = DEFAULT_REPLICATES
    return max(1, min(200, replicates))


def _worker_init(
    attacker_cfg: Dict[str, Any],
    defender_cfg: Dict[str, Any],
    rally_mode: bool,
    replicates: int,
) -> None:
    global _WORKER_ATTACKER_CFG, _WORKER_DEFENDER_CFG, _WORKER_RALLY_MODE, _WORKER_REPLICATES
    _WORKER_ATTACKER_CFG = attacker_cfg
    _WORKER_DEFENDER_CFG = defender_cfg
    _WORKER_RALLY_MODE = rally_mode
    _WORKER_REPLICATES = replicates
    prepare_simulation_environment()


def _evaluate_composition(composition: Tuple[int, int, int]) -> Dict[str, Any]:
    if _WORKER_ATTACKER_CFG is None or _WORKER_DEFENDER_CFG is None:
        raise RuntimeError("Optimizer worker not initialized")

    infantry, lancer, marksman = composition
    attacker_cfg = copy.deepcopy(_WORKER_ATTACKER_CFG)
    attacker_cfg["troops"] = {
        **(attacker_cfg.get("troops", {}) or {}),
        "infantry": infantry,
        "lancer": lancer,
        "marksman": marksman,
    }

    outcomes = []
    attacker_wins = 0
    total_attacker_left = 0
    total_defender_left = 0

    for _ in range(_WORKER_REPLICATES):
        battle = fight_once(attacker_cfg, _WORKER_DEFENDER_CFG, _WORKER_RALLY_MODE)
        outcome = int(battle["outcome"])
        outcomes.append(outcome)
        attacker_remaining = int(battle["attacker_remaining"])
        defender_remaining = int(battle["defender_remaining"])
        total_attacker_left += attacker_remaining
        total_defender_left += defender_remaining
        if attacker_remaining > defender_remaining:
            attacker_wins += 1

    mean_outcome = statistics.fmean(outcomes) if outcomes else 0.0
    total = max(1, infantry + lancer + marksman)
    return {
        "infantry_count": infantry,
        "lancer_count": lancer,
        "marksman_count": marksman,
        "infantry_pct": (infantry / total) * 100,
        "lancer_pct": (lancer / total) * 100,
        "marksman_pct": (marksman / total) * 100,
        "win_rate": attacker_wins / _WORKER_REPLICATES if _WORKER_REPLICATES else 0.0,
        "win_rate_pct": (attacker_wins / _WORKER_REPLICATES) * 100 if _WORKER_REPLICATES else 0.0,
        "avg_margin": mean_outcome,
        "avg_attacker_left": total_attacker_left / _WORKER_REPLICATES if _WORKER_REPLICATES else 0.0,
        "avg_defender_left": total_defender_left / _WORKER_REPLICATES if _WORKER_REPLICATES else 0.0,
    }


def main() -> int:
    raw = sys.stdin.read()
    try:
        config = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"Invalid JSON: {exc}", file=sys.stderr)
        return 2

    attacker_cfg = config.get("attacker", {}) or {}
    defender_cfg = config.get("defender", {}) or {}
    rally_mode = bool(config.get("rally_mode", False))

    total = sum(
        int((attacker_cfg.get("troops", {}) or {}).get(cat, 0) or 0)
        for cat in ("infantry", "lancer", "marksman")
    )
    if total <= 0:
        print("Attacker must have at least one troop to optimize a ratio.", file=sys.stderr)
        return 2

    step = _normalise_step(total, config.get("grid_step"))
    replicates = _normalise_replicates(config.get("search_replicates"))
    top_n = max(1, min(25, int(config.get("top_n", DEFAULT_TOP_RESULTS) or DEFAULT_TOP_RESULTS)))
    max_workers = max(1, min(DEFAULT_MAX_WORKERS, int(config.get("jobs", DEFAULT_MAX_WORKERS) or DEFAULT_MAX_WORKERS)))

    composition_count = _composition_count(total, step)
    projected_battles = composition_count * replicates
    if composition_count > MAX_COMPOSITIONS:
        print(
            f"Grid too fine: {composition_count} compositions exceeds the limit of {MAX_COMPOSITIONS}. "
            "Increase the grid step.",
            file=sys.stderr,
        )
        return 2
    if projected_battles > MAX_SIMULATIONS:
        print(
            f"Search too expensive: {projected_battles} projected battles exceeds the limit of {MAX_SIMULATIONS}. "
            "Increase the grid step or lower search replicates.",
            file=sys.stderr,
        )
        return 2

    prepare_simulation_environment()
    compositions = list(_composition_grid(total, step))

    if max_workers <= 1 or len(compositions) <= 1:
        _worker_init(attacker_cfg, defender_cfg, rally_mode, replicates)
        results = [_evaluate_composition(comp) for comp in compositions]
    else:
        results = []
        with ProcessPoolExecutor(
            max_workers=min(max_workers, len(compositions)),
            initializer=_worker_init,
            initargs=(attacker_cfg, defender_cfg, rally_mode, replicates),
        ) as executor:
            futures = [executor.submit(_evaluate_composition, comp) for comp in compositions]
            for future in as_completed(futures):
                results.append(future.result())

    results.sort(
        key=lambda row: (
            row["win_rate"],
            row["avg_margin"],
            row["avg_attacker_left"],
            -row["avg_defender_left"],
        ),
        reverse=True,
    )

    best = dict(results[0])
    best["rank"] = 1
    best["is_best"] = True

    top_results = []
    for index, row in enumerate(results[:top_n], start=1):
        entry = dict(row)
        entry["rank"] = index
        entry["is_best"] = index == 1
        top_results.append(entry)

    points = []
    for row in results:
        point = dict(row)
        point["is_best"] = (
            row["infantry_count"] == best["infantry_count"]
            and row["lancer_count"] == best["lancer_count"]
            and row["marksman_count"] == best["marksman_count"]
        )
        points.append(point)

    json.dump(
        {
            "total_troops": total,
            "grid_step": step,
            "compositions_tested": composition_count,
            "projected_battles": projected_battles,
            "replicates_per_ratio": replicates,
            "best": best,
            "top_results": top_results,
            "points": points,
        },
        sys.stdout,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Optimize ratio error: {exc}", file=sys.stderr)
        import traceback

        traceback.print_exc(file=sys.stderr)
        raise
