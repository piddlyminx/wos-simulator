"""
run_testcase.py — End-to-end battle testcase runner.

Flow:
1. Find an empty tile near the defender's city
2. Deploy defender army to that tile; wait for it to arrive (~30s)
3. On attacker instance: navigate to tile, wait for Attack button (defender arrived)
4. Deploy attacker army
5. Wait for battle to complete (march overlay shows Returning/gone)
6. Capture war report from attacker
7. Write emulator result into wos-simulator testcase JSON

Spec format (tile coords NOT required — found dynamically):
{
    "test_id": "simple_001",
    "description": "...",
    "emulator": {
        "defender": {"instance": "defender-instance"},
        "attacker": {"instance": "attacker-instance"}
    },
    "attacker": {
        "heroes": {},
        "troops": {"lancer_t8": 200}
    },
    "defender": {
        "heroes": {},
        "troops": {"lancer_t9": 200}
    }
}

Output testcase (appended to game_report_result array):
{
    "test_id": "simple_001",
    "attacker": { "name": ..., "heroes": {}, "troops": {...}, "stats": {...}, "joiner_heroes": {} },
    "defender": { "name": ..., "heroes": {}, "troops": {...}, "stats": {...}, "joiner_heroes": {} },
    "game_report_result": [
        {
            "timestamp": "2026-03-17 03:05",
            "attacker": 0,
            "defender": 195,
            "attacker_stats": {...},
            "defender_stats": {...}
        }
    ]
}
"""
from __future__ import annotations

import json
import logging
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# ─── Paths ─────────────────────────────────────────────────────────────────────
_SCRIPT_DIR  = Path(__file__).resolve().parent
_SKILL_DIR   = _SCRIPT_DIR.parent
_SIM_DIR     = _SKILL_DIR.parent
_WOSCTL      = str(_SCRIPT_DIR / "wosctl")

# Add scripts dir to path for dispatch imports
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

logger = logging.getLogger(__name__)

# ─── Stat mapping: report field prefix → simulator key ────────────────────────
_STAT_MAP    = {"infantry": "inf", "lancer": "lanc", "marksman": "mark"}
_STAT_FIELDS = ["attack", "defense", "lethality", "health"]

_HERO_SKILLS_FILE = _SKILL_DIR / "data" / "player_hero_skills.json"
_TESTCASES = _SIM_DIR / "testcases" / "emulator_verified"


def _load_hero_skills_for_instance(instance_name: str) -> dict:
    """Load saved hero skill levels for an instance from player_hero_skills.json."""
    if not _HERO_SKILLS_FILE.exists():
        return {}
    try:
        data = json.loads(_HERO_SKILLS_FILE.read_text())
        return data.get(instance_name, {})
    except (json.JSONDecodeError, OSError):
        return {}


def _enrich_heroes(hero_list: list, instance_name: str, _retried: bool = False) -> dict:
    """Convert a flat hero name list to a skill-level dict using saved data.

    If any hero is missing, runs capture-hero-skills automatically and retries
    once. Raises RuntimeError if the hero is still missing after the retry.
    """
    if not hero_list:
        return {}
    saved = _load_hero_skills_for_instance(instance_name)
    missing = [
        name for name in hero_list
        if name.lower() not in ("vacant", "none", "") and name not in saved
    ]
    if missing and not _retried:
        logger.warning(
            "Hero skills missing for %s on %s — running capture-hero-skills and retrying.",
            missing, instance_name,
        )
        _wosctl("--instance", instance_name, "capture-hero-skills")
        return _enrich_heroes(hero_list, instance_name, _retried=True)
    if missing:
        raise RuntimeError(
            f"Cannot find hero skill levels for {missing} on instance '{instance_name}' "
            f"even after capture-hero-skills. Check that the hero is visible in-game."
        )
    return {
        name: saved[name]
        for name in hero_list
        if name.lower() not in ("vacant", "none", "")
    }


def _validate_hero_names(spec_heroes: dict, actual_heroes: dict, side: str) -> None:
    """Fail when the actual hero names do not match the hero names requested in the spec."""
    expected = set(spec_heroes.keys())
    actual = set(actual_heroes.keys())
    if expected == actual:
        return

    missing = sorted(expected - actual)
    unexpected = sorted(actual - expected)
    parts = [f"{side} hero mismatch"]
    if missing:
        parts.append(f"missing from report: {missing}")
    if unexpected:
        parts.append(f"unexpected on report: {unexpected}")
    parts.append(f"expected={sorted(expected)}")
    parts.append(f"actual={sorted(actual)}")
    raise RuntimeError("; ".join(parts))


def _wosctl(*args: str, timeout: int = 180) -> dict:
    """Run wosctl and return parsed JSON output."""
    cmd = [_WOSCTL] + list(args)
    logger.info("wosctl %s", " ".join(args))
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        raise RuntimeError(f"wosctl non-JSON output:\nSTDOUT: {result.stdout[:500]}\nSTDERR: {result.stderr[:200]}")


def _map_stats(stat_bonuses: dict) -> dict:
    return {
        sim_key: {f: stat_bonuses.get(f"{troop}_{f}", 0.0) for f in _STAT_FIELDS}
        for troop, sim_key in _STAT_MAP.items()
    }



def run_testcase(spec_path: str, dry_run: bool = False, debug: bool = False) -> dict:
    spec       = json.loads(Path(spec_path).read_text())
    test_id    = spec["test_id"]
    description = spec.get("description", "")
    emulator   = spec["emulator"]
    def_instance = emulator["defender"]["instance"]
    atk_instance = emulator["attacker"]["instance"]

    logger.info("=" * 60)
    logger.info("Testcase: %s", test_id)
    logger.info("Defender: %s | Attacker: %s", def_instance, atk_instance)

    if dry_run:
        logger.info("[DRY RUN] Skipping all emulator steps")
        return {"ok": True, "dry_run": True, "test_id": test_id}

    # Import emulator / dispatch / navigation
    from dispatch import (
        find_empty_tile, attack_when_ready, wait_for_battle_complete,
        deploy_army, TROOP_DISPLAY_NAMES, recall_camp, WosDispatchError
    )
    from emulator import resolve_instance, WosEmulator

    # ── Step 1: Resolve both instances → WosEmulator objects ─────────────────
    def_emulator: WosEmulator = resolve_instance(def_instance)
    atk_emulator: WosEmulator = resolve_instance(atk_instance)

    # Load alliance config for both players upfront — used for pre-battle
    # alliance check and for heal-on-demand paths later.
    from alliance import ensure_in_alliance, load_player_alliance_config
    def_cfg = load_player_alliance_config(def_instance)
    atk_cfg = load_player_alliance_config(atk_instance)

    # ── Step 1b: Recall any existing troops before starting ───────────────────
    logger.info("Recalling any existing marching troops before testcase...")
    recall_camp(def_emulator)
    recall_camp(atk_emulator)

    # ── Step 1c: Ensure both players are in their battle alliance ─────────────
    if def_cfg["battle_alliance"]:
        logger.info("Ensuring %s is in battle alliance %s", def_instance, def_cfg["battle_alliance"])
        ensure_in_alliance(def_emulator, def_cfg["battle_alliance"])
    if atk_cfg["battle_alliance"]:
        logger.info("Ensuring %s is in battle alliance %s", atk_instance, atk_cfg["battle_alliance"])
        ensure_in_alliance(atk_emulator, atk_cfg["battle_alliance"])

    # ── Step 2: Find empty tile near defender's city ──────────────────────────
    logger.info("Finding empty tile near %s city...", def_instance)
    world_x, world_y = find_empty_tile(def_emulator)
    logger.info("Empty tile: world=X:%d Y:%d", world_x, world_y)
    SCREEN_CENTRE = (360, 640)

    # ── Step 3: Deploy defender army to that tile ─────────────────────────────
    # Army selection screen is already open at this point (from find_empty_tile), so we can deploy directly without navigation.
    def_army_spec = {
        "heroes": spec["defender"].get("heroes", {}),
        "troops": spec["defender"]["troops"],
    }
    logger.info("Deploying defender army...")
    try:
        def_result = deploy_army(def_emulator, def_army_spec)
    except WosDispatchError as e:
        if "available" in str(e):
            from heal import heal_troops
            from navigation import goto_coord, find_template
            from dispatch import _find_and_tap, TPL_OCCUPY
            logger.info("Defender has insufficient troops — healing and retrying...")
            heal_troops(def_emulator, home_tag=def_cfg.get("battle_alliance", ""))
            # Heal leaves us on world map; navigate to tile and reopen Occupy with retry
            goto_coord(def_emulator, world_x, world_y)
            time.sleep(1)
            _occ_found = False
            for _attempt in range(1, 4):
                def_emulator.tap(360, 640)
                time.sleep(2)
                _img = def_emulator.screencap_bgr()
                _occ_found, _ = find_template(_img, TPL_OCCUPY)
                if _occ_found:
                    break
                logger.warning("Defender tile popup not opened (attempt %d/3) — retrying tap", _attempt)
            if not _occ_found:
                raise WosDispatchError("Occupy popup did not appear after 3 taps following defender heal")
            _find_and_tap(def_emulator, TPL_OCCUPY, "Occupy")
            time.sleep(3)
            def_result = deploy_army(def_emulator, def_army_spec)
        else:
            raise
    if not def_result.get("ok"):
        raise RuntimeError(f"Defender deploy failed: {def_result}")
    logger.info("Defender army deployed, marching... waiting 5s before proceeding to attacker steps")
    time.sleep(5)

    # ── Step 3b: Fingerprint latest report timestamp BEFORE the battle ──────
    # This avoids the stale-report bug where time.time() doesn't match
    # the game's report timestamps (which use calendar UTC).
    from report_reader import get_latest_report_timestamp
    pre_battle_ts = get_latest_report_timestamp(atk_emulator, tab="war")
    logger.info("Pre-battle latest report timestamp: %.0f", pre_battle_ts)

    # ── Step 4: Attack+deploy attacker army when ready (self-contained) ──────
    logger.info("Waiting for defender to arrive, then attacking...")

    atk_army_spec = {
        "heroes": spec["attacker"].get("heroes", {}),
        "troops": spec["attacker"]["troops"],
    }
    try:
        atk_result = attack_when_ready(atk_emulator, world_x, world_y, atk_army_spec, timeout_sec=180, poll_sec=5)
    except WosDispatchError as e:
        if "available" in str(e):
            from heal import heal_troops
            logger.info("Attacker has insufficient troops — healing and retrying...")
            heal_troops(atk_emulator, home_tag=atk_cfg.get("battle_alliance", ""))
            # attack_when_ready handles its own navigation back to the tile
            atk_result = attack_when_ready(atk_emulator, world_x, world_y, atk_army_spec, timeout_sec=180, poll_sec=5)
        else:
            raise
    if not atk_result.get("ok"):
        raise RuntimeError(f"Attacker deploy failed: {atk_result}")
    logger.info("Attacker army deployed, battle underway...")

    # ── Step 7: Wait for battle to complete ───────────────────────────────────
    # Use pre-battle timestamp to correctly detect NEW reports only.
    wait_for_battle_complete(atk_emulator, after=pre_battle_ts, timeout_sec=600, poll_sec=5)
    logger.info("Battle complete!")

    # Recall any existing camp troops
    recall_camp(def_emulator)
    recall_camp(atk_emulator)

    # ── Step 8: Capture war report (first in list) ────────────────────────────
    logger.info("Capturing war report (first in list)...")
    report_args = ["--instance", atk_instance]
    if debug:
        report_args.append("--debug")
    report_args.extend(["report", "--tab", "war"])
    report = _wosctl(*report_args)
    if "left" not in report or "right" not in report:
        raise RuntimeError(f"Could not capture war report: {report}")

    # ── Step 9: Build emulator result ─────────────────────────────────────────
    left, right = report["left"], report["right"]
    atk_rep = left  if left["role"]  == "attacker" else right
    def_rep = right if right["role"] == "defender" else left

    emulator_result = {
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "tile": {"x": world_x, "y": world_y},
        "attacker": atk_rep.get("survivors", 0),
        "defender": def_rep.get("survivors", 0),
        "attacker_stats": _map_stats(atk_rep.get("stat_bonuses", {})),
        "defender_stats": _map_stats(def_rep.get("stat_bonuses", {})),
        "attacker_heroes": atk_rep.get("heroes", []),
        "defender_heroes": def_rep.get("heroes", []),
    }

    # ── Step 10: Build/update simulator testcase JSON ─────────────────────────
    _TESTCASES.mkdir(parents=True, exist_ok=True)
    out_path = _TESTCASES / f"{test_id}.json"

    # Load existing testcase list (if any)
    existing_list = []
    if out_path.exists():
        existing = json.loads(out_path.read_text())
        if isinstance(existing, list):
            existing_list = existing
        else:
            existing_list = [existing]
    for existing_tc in existing_list:
        if isinstance(existing_tc, dict):
            existing_tc.pop("sim_result", None)

    # Build this run's parameters for comparison
    atk_heroes = _enrich_heroes(atk_rep.get("heroes", []) or [], atk_instance)
    def_heroes = _enrich_heroes(def_rep.get("heroes", []) or [], def_instance)
    _validate_hero_names(spec["attacker"].get("heroes", {}), atk_heroes, "Attacker")
    _validate_hero_names(spec["defender"].get("heroes", {}), def_heroes, "Defender")
    this_run_stats = emulator_result["attacker_stats"]
    this_run_def_stats = emulator_result["defender_stats"]
    # Use ACTUAL troop counts from war report, not the spec — the player may not
    # have had enough troops to fill the requested amount.
    def _troop_detail_to_key(troop: dict) -> str | None:
        troop_type = troop.get("type")
        tier = troop.get("tier")
        if troop_type not in {"infantry", "lancer", "marksman"} or tier is None:
            return None
        try:
            tier_int = int(tier)
        except (TypeError, ValueError):
            return None
        key = f"{troop_type}_t{tier_int}"
        fc = troop.get("fire_crystal_level")
        try:
            fc_int = int(fc)
        except (TypeError, ValueError):
            fc_int = 0
        if fc_int > 0:
            key += f"_fc{fc_int}"
        return key

    def _report_troops_to_sim(report: dict, spec_troops: dict) -> dict:
        """Convert war report troop_power {infantry:N, lancer:N, marksman:N} to sim format.

        Prefer explicit report troop detail with tier/fire-crystal metadata.
        Fall back to spec_troops tier inference for older parsed reports.
        """
        troops_detail = report.get("troops_detail") or []
        detailed: dict[str, int] = {}
        for troop in troops_detail:
            key = _troop_detail_to_key(troop)
            if key:
                detailed[key] = int(troop.get("count") or 0)
        if detailed:
            return detailed

        troop_power = report.get("troop_power", {})
        type_to_key: dict[str, str] = {}
        for key in spec_troops:
            for prefix in ("infantry", "lancer", "marksman"):
                if key.startswith(prefix + "_"):
                    type_to_key[prefix] = key
                    break
        return {
            type_to_key.get("infantry", "infantry_t6"): troop_power.get("infantry", 0),
            type_to_key.get("lancer", "lancer_t6"): troop_power.get("lancer", 0),
            type_to_key.get("marksman", "marksman_t6"): troop_power.get("marksman", 0),
        }

    spec_att = spec["attacker"]["troops"]
    spec_def = spec["defender"]["troops"]
    this_run_troops_att = _report_troops_to_sim(atk_rep, spec_att)
    this_run_troops_def = _report_troops_to_sim(def_rep, spec_def)

    # Sanity check: FAIL if actual troops differ from spec — the player didn't have
    # enough troops, so the battle wasn't what we intended to test.
    # Strip zero values from actual so sparse specs (e.g. {"infantry_t6": 1000}) compare
    # correctly against the report which always includes all troop types.
    actual_att_nonzero = {k: v for k, v in this_run_troops_att.items() if v != 0}
    actual_def_nonzero = {k: v for k, v in this_run_troops_def.items() if v != 0}
    troop_mismatch = False
    if actual_att_nonzero != spec_att:
        logger.error(
            "❌  Attacker actual troops %s differ from spec %s — "
            "player did not have enough troops to fill the request!",
            this_run_troops_att, spec_att,
        )
        troop_mismatch = True
    if actual_def_nonzero != spec_def:
        logger.error(
            "❌  Defender actual troops %s differ from spec %s — "
            "player did not have enough troops to fill the request!",
            this_run_troops_def, spec_def,
        )
        troop_mismatch = True
    if troop_mismatch:
        raise RuntimeError(
            f"Troop count mismatch! Actual attacker={this_run_troops_att}, "
            f"spec={spec_att}; Actual defender={this_run_troops_def}, "
            f"spec={spec_def}. Battle result NOT recorded. "
            f"Fix troop availability or adjust the testcase spec."
        )
    game_result = {"attacker": emulator_result["attacker"], "defender": emulator_result["defender"]}

    # Check if the last entry in the file has identical setup (stats, troops, heroes, skills).
    # If so, append the result to that entry — multiple results for the same battle config
    # are useful for RNG-based scenarios. If anything differs, create a new entry.
    reuse_existing = False
    if existing_list:
        last = existing_list[-1]
        if (last.get("attacker", {}).get("stats") == this_run_stats
                and last.get("defender", {}).get("stats") == this_run_def_stats
                and last.get("attacker", {}).get("troops") == this_run_troops_att
                and last.get("defender", {}).get("troops") == this_run_troops_def
                and last.get("attacker", {}).get("heroes") == atk_heroes
                and last.get("defender", {}).get("heroes") == def_heroes):
            reuse_existing = True
            tc = last
            logger.info("Setup matches previous entry — appending result to existing testcase")

    if not reuse_existing:
        tc = {
            "test_id": test_id,
            "description": description,
            "attacker": {
                "name": atk_rep.get("name", atk_instance),
                "heroes": atk_heroes,
                "troops": this_run_troops_att,
                "stats": this_run_stats,
                "joiner_heroes": {},
            },
            "defender": {
                "name": def_rep.get("name", def_instance),
                "heroes": def_heroes,
                "troops": this_run_troops_def,
                "stats": this_run_def_stats,
                "joiner_heroes": {},
            },
            "game_report_result": [],
        }
        existing_list.append(tc)
        logger.info("Setup differs from previous entry — creating new testcase entry")

    if not isinstance(tc.get("game_report_result"), list):
        tc["game_report_result"] = []
    tc["game_report_result"].append(game_result)

    out_path.write_text(json.dumps(existing_list, indent=2))
    logger.info("Testcase written to: %s", out_path)

    result_payload = {
        "ok": True,
        "test_id": test_id,
        "world_coord": {"x": world_x, "y": world_y},
        "result": report.get("result", "unknown"),
        "attacker_survivors": emulator_result["attacker"],
        "defender_survivors": emulator_result["defender"],
        "saved_to": str(out_path),
    }
    if report.get("debug_dir"):
        result_payload["debug_dir"] = report["debug_dir"]
    return result_payload


if __name__ == "__main__":
    raise SystemExit("Use 'wosctl run-testcase ...' instead.")
