"""
dispatch.py — Army dispatch automation for wosctl.

Implements deploy_army(emulator, army_spec) which:
1. Navigates to world map
2. Taps an empty tile + template-matches Occupy button
3. Template-matches and taps Preset 1 to clear the slate
4. For each hero in the spec: opens hero picker, scrolls to find by template, assigns
5. For each troop type: OCR-locates the row, taps count pill, clears + types count
6. Template-matches and taps Deploy

Army spec format (simulator-compatible):
{
    "heroes": {
        "Jessie": {"skill_1": 5, "skill_2": 2},
        "Sergei": {"skill_1": 3, "skill_2": 1}
    },
    "troops": {
        "lancer_t9": 100,
        "infantry_t9": 150
    }
}

All public functions accept ``WosEmulator`` rather than a raw ``serial: str``.
"""
from __future__ import annotations

import logging
import re
import time
from pathlib import Path
from typing import TYPE_CHECKING, Optional

import cv2
import numpy as np

if TYPE_CHECKING:
    from emulator import WosEmulator

from emulator import WosError
from navigation import (
    find_template,
    goto_world_map,
    WosNavigationError,
)

logger = logging.getLogger(__name__)

# ─── Paths ─────────────────────────────────────────────────────────────────────
_SKILL_DIR = Path(__file__).resolve().parent.parent
_TPL = _SKILL_DIR / "templates"
_HEROES_DIR = _TPL / "heroes"

# ─── Templates ─────────────────────────────────────────────────────────────────
TPL_OCCUPY            = str(_TPL / "tile_occupy_button.png")
TPL_ATTACK            = str(_TPL / "tile_attack_button.png")
TPL_RECALL            = str(_TPL / "tile_recall_button.png")
TPL_CAMP_RECALL       = str(_TPL / "camp_recall_button.png")
TPL_RECALL_CONFIRM    = str(_TPL / "recall_confirm_button.png")
TPL_PRESET1           = str(_TPL / "deploy_preset1_tab.png")
TPL_HERO_ASSIGN       = str(_TPL / "hero_picker_assign_btn.png")
TPL_HERO_REMOVE       = str(_TPL / "hero_picker_remove_btn.png")
TPL_WITHDRAW_ALL      = str(_TPL / "deploy_withdraw_all_btn.png")
TPL_DEPLOY_BTN        = str(_TPL / "deploy_button.png")

# ─── Troop name mapping: simulator key → in-game OCR label ─────────────────────
TROOP_DISPLAY_NAMES: dict[str, str] = {
    # T11 Helios
    "infantry_t11": "Helios Infantry",
    "lancer_t11":   "Helios Lancer",
    "marksman_t11": "Helios Marksman",
    # T10 Apex
    "infantry_t10":  "Apex Infantry",
    "lancer_t10":    "Apex Lancer",
    "marksman_t10":  "Apex Marksman",
    # T9 Supreme
    "infantry_t9":   "Supreme Infantry",
    "lancer_t9":     "Supreme Lancer",
    "marksman_t9":   "Supreme Marksman",
    # T8 Elite
    "infantry_t8":   "Elite Infantry",
    "lancer_t8":     "Elite Lancer",
    "marksman_t8":   "Elite Marksman",
    # T7 Brave
    "infantry_t7":   "Brave Infantry",
    "lancer_t7":     "Brave Lancer",
    "marksman_t7":   "Brave Marksman",
    # T6 Heroic (per Paul)
    "infantry_t6":   "Heroic Infantry",
    "lancer_t6":     "Heroic Lancer",
    "marksman_t6":   "Heroic Marksman",
}

# x coordinate of the count pill (constant — pill is always at same x relative to screen)
_PILL_X = 430

_TROOP_RANKS = ("Helios", "Apex", "Supreme", "Elite", "Brave", "Heroic")
_TROOP_TYPES = ("Infantry", "Lancer", "Marksman")

# ─── Hero scroll constants ─────────────────────────────────────────────────────
# Hero list (scrollable grid) occupies roughly y=590–900 on the popup.
# Use 240px swipes within that range (640–880) to move ~1.6 hero rows per scroll.
# 100px swipes (the old default) only moved ~0.6 rows — too little to reach
# low-power heroes (e.g. Zinman) after 2 higher-power heroes are already assigned.
_SCROLL_UP_FROM_Y   = 640   # drag start (scroll UP to see earlier heroes)
_SCROLL_UP_TO_Y     = 880
_SCROLL_DOWN_FROM_Y = 880   # drag start (scroll DOWN to see later heroes)
_SCROLL_DOWN_TO_Y   = 640
_SCROLL_X           = 360
_HERO_SWIPE_DUR_MS  = 750   # slower = less momentum/overshoot

# Hero slot tap positions (on deploy screen, blank preset)
_HERO_SLOTS = [(165, 420), (360, 420), (555, 420)]


# Candidate screen positions to probe for empty tiles (relative to screen centre)
# Probe positions offset from screen centre — avoid city tile at centre
# City appears at roughly (360, 580) when map is centred on it
_TILE_PROBE_COORDS = [
    (150, 400), (570, 400),
    (150, 300), (570, 300),
    (150, 500), (570, 500),
    (360, 300), (360, 250),
    (250, 350), (470, 350),
    (250, 480), (470, 480),
]

# ─── Exceptions ────────────────────────────────────────────────────────────────
class WosDispatchError(WosError):
    """Raised when dispatch cannot complete."""


# ─── Internal helpers ──────────────────────────────────────────────────────────
def _find_and_tap(emulator: WosEmulator, template_path: str, label: str, threshold: float = 0.85) -> tuple[int, int]:
    """Screencap, find template, tap it. Raises WosDispatchError if not found."""
    img = emulator.screencap_bgr()
    found, (cx, cy) = find_template(img, template_path, threshold=threshold)
    if not found:
        raise WosDispatchError(f"{label}: template not found ({template_path})")
    logger.info("%s: tapping (%d,%d)", label, cx, cy)
    emulator.tap(cx, cy)
    return cx, cy


def _find_hero_on_screen(emulator: WosEmulator, hero_name: str) -> Optional[tuple[int, int]]:
    """Return tap coords if hero template found on current screen, else None."""
    tpl_path = str(_HEROES_DIR / f"{hero_name.replace(' ', '_')}.png")
    if not Path(tpl_path).exists():
        raise WosDispatchError(f"No template for hero '{hero_name}' at {tpl_path}")
    img = emulator.screencap_bgr()
    found, (cx, cy) = find_template(img, tpl_path, threshold=0.75)
    return (cx, cy) if found else None


def _scroll_hero_list(emulator: WosEmulator, direction: str = "up") -> None:
    """
    Scroll the hero picker list.
    direction='up'  → reveals earlier heroes (drag finger downward)
    direction='down'→ reveals later heroes (drag finger upward)
    """
    if direction == "up":
        fy, ty = _SCROLL_UP_FROM_Y, _SCROLL_UP_TO_Y
    else:
        fy, ty = _SCROLL_DOWN_FROM_Y, _SCROLL_DOWN_TO_Y
    emulator.shell(f"input swipe {_SCROLL_X} {fy} {_SCROLL_X} {ty} {_HERO_SWIPE_DUR_MS}")
    time.sleep(1)


def _assign_hero(emulator: WosEmulator, hero_name: str, max_scrolls: int = 10) -> None:
    """
    Find hero by template (scrolling if needed) and tap Assign.
    Scrolls down first, then if not found scrolls back up from the bottom.
    """
    # Phase 1: scroll down
    for scroll_num in range(max_scrolls):
        coords = _find_hero_on_screen(emulator, hero_name)
        if coords:
            cx, cy = coords
            logger.info("assign_hero '%s': found at (%d,%d), tapping", hero_name, cx, cy)
            emulator.tap(cx, cy)
            time.sleep(0.8)
            _find_and_tap(emulator, TPL_HERO_ASSIGN, f"Assign ({hero_name})")
            time.sleep(1.5)
            logger.info("assign_hero '%s': assigned", hero_name)
            return
        logger.info("assign_hero '%s': not visible (scroll %d/%d down), scrolling down", hero_name, scroll_num + 1, max_scrolls)
        _scroll_hero_list(emulator, direction="down")

    # Phase 2: scroll back up (hero may be above current position)
    for scroll_num in range(max_scrolls * 2):
        coords = _find_hero_on_screen(emulator, hero_name)
        if coords:
            cx, cy = coords
            logger.info("assign_hero '%s': found at (%d,%d) on scroll up, tapping", hero_name, cx, cy)
            emulator.tap(cx, cy)
            time.sleep(0.8)
            _find_and_tap(emulator, TPL_HERO_ASSIGN, f"Assign ({hero_name})")
            time.sleep(1.5)
            logger.info("assign_hero '%s': assigned", hero_name)
            return
        logger.info("assign_hero '%s': not visible (scroll %d/%d up), scrolling up", hero_name, scroll_num + 1, max_scrolls * 2)
        _scroll_hero_list(emulator, direction="up")

    raise WosDispatchError(f"Hero '{hero_name}' not found after {max_scrolls * 3} scrolls (down+up)")


def _normalize_troop_text(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def _troop_name_parts(display_name: str) -> tuple[str, str]:
    parts = display_name.split()
    if len(parts) != 2:
        raise WosDispatchError(f"Unsupported troop display name: {display_name!r}")
    return parts[0], parts[1]


def _troop_rows_from_ocr_lines(
    lines: list[tuple[list[list[float]], str, float]],
    *,
    y_offset: int = 0,
    y_tolerance: int = 16,
) -> dict[str, int]:
    rows: list[list[dict[str, object]]] = []
    result: dict[str, int] = {}

    for box, text, _conf in lines:
        clean_text = str(text).strip()
        if not clean_text:
            continue

        xs = [point[0] for point in box]
        ys = [point[1] for point in box]
        cx = int(sum(xs) / len(xs))
        cy = int(sum(ys) / len(ys)) + y_offset

        avail_match = re.match(r"^/(\d[\d,]*)$", clean_text)
        if avail_match:
            result[f"__avail__{cy}"] = int(avail_match.group(1).replace(",", ""))
            continue

        item = {"text": clean_text, "x": cx, "y": cy}
        for row in rows:
            if abs(int(row[0]["y"]) - cy) <= y_tolerance:
                row.append(item)
                break
        else:
            rows.append([item])

    for row in rows:
        row.sort(key=lambda item: int(item["x"]))
        text = " ".join(str(item["text"]) for item in row)
        normalized = _normalize_troop_text(text)
        rank = next((candidate for candidate in _TROOP_RANKS if _normalize_troop_text(candidate) in normalized), None)
        troop_type = next((candidate for candidate in _TROOP_TYPES if _normalize_troop_text(candidate) in normalized), None)
        if rank is None or troop_type is None:
            continue

        cy = int(round(sum(int(item["y"]) for item in row) / len(row)))
        result[f"{rank} {troop_type}"] = cy

    return result


def _ocr_troop_rows(emulator: WosEmulator) -> dict[str, int]:
    """
    OCR the troop section of the deploy screen.
    Returns {display_name: row_center_y} for all detected troop rows.
    Also stores available counts keyed as '/display_name' for use by deploy_army.
    """
    try:
        from ocr import RapidOCR
    except ImportError as e:
        raise WosDispatchError(f"RapidOCR not available: {e}")

    img = emulator.screencap_bgr()
    ocr = RapidOCR()
    # Crop troop section (below hero slots, above deploy button)
    # Make this slightly taller to reduce "one row just outside crop" issues.
    troop_area = img[520:1040, 0:720]
    result, _ = ocr(troop_area)
    rows = _troop_rows_from_ocr_lines(result or [], y_offset=520)
    logger.info("OCR troop rows: %s", rows)
    return rows


def _set_troop_count(emulator: WosEmulator, display_name: str, count: int, row_cy: int) -> None:
    """Tap count pill for a troop row, clear with backspaces, type count, confirm with Enter."""
    pill_x = _PILL_X
    logger.info("set_troop '%s': tapping pill at (%d,%d) count=%d", display_name, pill_x, row_cy, count)
    emulator.tap(pill_x, row_cy)
    time.sleep(1)
    # Clear existing value with 6 backspaces
    emulator.shell("input keyevent 67 67 67 67 67 67")
    time.sleep(0.3)
    # Type the count
    emulator.shell(f"input text '{count}'")
    time.sleep(0.3)
    # Confirm with Enter
    emulator.shell("input keyevent 66")
    time.sleep(0.5)
    logger.info("set_troop '%s': count=%d entered", display_name, count)


def recall_camp(emulator: WosEmulator) -> None:
    """Navigate to world map and tap the recall button to recall all marching troops."""
    from navigation import goto_world_map
    goto_world_map(emulator)
    time.sleep(1)
    try:
        logger.info("recall_camp: tapping camp recall button")
        _find_and_tap(emulator, TPL_CAMP_RECALL, "RecallCamp")
        time.sleep(1)
        logger.info("recall_camp: confirming recall")
        _find_and_tap(emulator, TPL_RECALL_CONFIRM, "RecallConfirm")
        time.sleep(1)
        logger.info("recall_camp: troops recalled")
    except WosDispatchError:
        logger.info("recall_camp: camp recall button not found — no troops to recall")

# ─── Tile finding ─────────────────────────────────────────────────────────────
def find_empty_tile(emulator: WosEmulator) -> tuple[int, int]:
    """
    Find an empty occupiable tile on the world map near the city.

    First navigates city → world to ensure the world map opens centred on
    the city. Then probes candidate screen positions for an Occupy button.

    Returns:
        (world_x, world_y) — world coordinates of the empty tile.

    Raises:
        WosDispatchError if no empty tile found.
    """
    try:
        from ocr import RapidOCR
        _ocr = RapidOCR()
    except ImportError as e:
        raise WosDispatchError(f"RapidOCR not available: {e}")

    # Navigate city → world to centre map on the city.
    # First dismiss to city, then go to world — world map opens centred on city.
    from navigation import goto_city, goto_world_map, get_screen_state
    logger.info("find_empty_tile: navigating to city then world to centre map")
    goto_city(emulator)
    time.sleep(1)
    goto_world_map(emulator)
    time.sleep(1)

    # Transient march lines / overlays can block taps briefly.
    # Do multiple passes over the probe set before giving up.
    for pass_num in range(1, 4):
        logger.info("find_empty_tile: probe pass %d/3", pass_num)
        world_x, world_y = None, None
        for tap_x, tap_y in _TILE_PROBE_COORDS:
            logger.info("find_empty_tile: probing (%d,%d)", tap_x, tap_y)
            emulator.tap(tap_x, tap_y)
            time.sleep(2)

            img = emulator.screencap_bgr()
            found, (occ_cx, occ_cy) = find_template(img, TPL_OCCUPY)
            if not found:
                time.sleep(0.5)
                continue

            # Found Occupy — OCR the world coord from the popup.
            # The coord line "X:nnn Y:nnn" appears near the top of the tile popup card.
            # Crop the full popup area (wide region above and around the Occupy button)
            # so OCR can find the coordinate text regardless of exact popup position.
            import cv2
            x1 = 0
            x2 = min(img.shape[1], occ_cx + 250)
            y1 = max(0, occ_cy - 500)
            y2 = min(img.shape[0], occ_cy + 50)
            import numpy as _np
            coord_crop = img[y1:y2, x1:x2]

            debug_crop_path = f"/tmp/find_empty_tile_coord_crop_{tap_x}_{tap_y}.png"
            debug_full_img = f"/tmp/find_empty_tile_full_{tap_x}_{tap_y}.png"
            try:
                cv2.imwrite(debug_crop_path, coord_crop)
                cv2.imwrite(debug_full_img, img)
                logger.info(
                    "find_empty_tile: saved coord crop to %s (occ=(%d,%d) crop=[%d:%d,%d:%d])",
                    debug_crop_path, occ_cx, occ_cy, x1, x2, y1, y2
                )
            except Exception as e:
                logger.warning("find_empty_tile: failed to save coord crop: %s", e)

            ocr_result, _ = _ocr(coord_crop)
            world_x, world_y = None, None
            if ocr_result:
                import re as _re
                safe_lines = []
                for entry in ocr_result:
                    try:
                        _box, text, conf = entry
                        safe_lines.append((str(text), float(conf)))
                    except Exception:
                        safe_lines.append(repr(entry))
                logger.info("find_empty_tile: coord-crop OCR lines: %s", safe_lines)

                # Strategy: prefer X and Y from the SAME OCR line (avoids cross-line
                # misassembly e.g. X:781 from one line + Y:5 from a health bar).
                # Fall back to separate-line extraction only if single-line fails.
                # Sanity check: valid WOS world coords are in range 100–1100.
                _COORD_MIN, _COORD_MAX = 100, 1100

                def _valid_coord(v: int) -> bool:
                    return _COORD_MIN <= v <= _COORD_MAX

                for _box, text, _conf in ocr_result:
                    logger.info("find_empty_tile: OCR line: '%s' (conf %.2f)", text, float(_conf))
                    mx = _re.search(r'X[：:]\s*(\d+)', text)
                    my = _re.search(r'Y[：:]\s*(\d+)', text)
                    if mx and my:
                        cx, cy = int(mx.group(1)), int(my.group(1))
                        if _valid_coord(cx) and _valid_coord(cy):
                            world_x, world_y = cx, cy
                            break

                # if not (world_x and world_y):
                #     # Fallback: collect X and Y from separate lines
                #     _x, _y = None, None
                #     for _box, text, _conf in ocr_result:
                #         if _x is None:
                #             mx = _re.search(r'X[：:]\s*(\d+)', text)
                #             if mx:
                #                 v = int(mx.group(1))
                #                 if _valid_coord(v):
                #                     _x = v
                #         if _y is None:
                #             my = _re.search(r'Y[：:]\s*(\d+)', text)
                #             if my:
                #                 v = int(my.group(1))
                #                 if _valid_coord(v):
                #                     _y = v
                #     if _x and _y:
                #         world_x, world_y = _x, _y

                if world_x and world_y:
                    logger.info("find_empty_tile: coord OCR parsed X=%d Y=%d", world_x, world_y)
                else:
                    logger.warning("find_empty_tile: coord OCR found no valid X/Y in range %d–%d", _COORD_MIN, _COORD_MAX)
            else:
                logger.info("find_empty_tile: coord-crop OCR returned no lines")

            if world_x and world_y:
                logger.info("find_empty_tile: found empty tile at world X=%d Y=%d", world_x, world_y)
                # Tap Occupy to enter the deploy screen
                logger.info("find_empty_tile: tapping Occupy")
                _find_and_tap(emulator, TPL_OCCUPY, "Occupy")
                time.sleep(3)
                return world_x, world_y

        # Small wait between passes to let march lines clear
        time.sleep(2)

        if world_x and world_y:
            logger.info("find_empty_tile: found empty tile at world X=%d Y=%d", world_x, world_y)
            logger.info("find_empty_tile: tapping Occupy")
            _find_and_tap(emulator, TPL_OCCUPY, "Occupy")
            time.sleep(3)
            return world_x, world_y

        # Occupy found but couldn't OCR coord — dismiss and try next
        logger.warning("find_empty_tile: Occupy found at (%d,%d) but could not OCR world coord", tap_x, tap_y)
        # DEBUG: capture popup image for inspection
        try:
            import cv2
            debug_path = f"/tmp/find_empty_tile_ocr_fail_{tap_x}_{tap_y}.png"
            cv2.imwrite(debug_path, img)
            logger.warning("find_empty_tile: saved OCR-fail popup screenshot to %s", debug_path)
        except Exception as e:
            logger.warning("find_empty_tile: could not save OCR-fail screenshot: %s", e)

        emulator.shell("input keyevent 4")
        time.sleep(0.5)

    raise WosDispatchError("find_empty_tile: no empty tile found after 3 probe passes")


def attack_when_ready(
    emulator: WosEmulator,
    world_x: int,
    world_y: int,
    army_spec: dict,
    timeout_sec: int = 120,
    poll_sec: int = 5,
) -> dict:
    """Self-contained flow: wait until Attack is available, then attack+deploy.

    This avoids the brittle split of:
      wait_for_attack_available() (opens popup then closes it)
      + deploy_army(mode='attack') (reopens popup later)

    Instead we keep the flow in one loop and only reset (BACK) when needed.

    Returns: deploy_army result dict.
    Raises: WosDispatchError on timeout.
    """
    from navigation import goto_coord

    deadline = time.time() + timeout_sec

    while time.time() < deadline:
        # Always re-centre on the target coord; this is cheap and avoids drift.
        goto_coord(emulator, world_x, world_y)
        time.sleep(1)

        # Open tile popup
        CENTRE_X, CENTRE_Y = 360, 640
        emulator.tap(CENTRE_X, CENTRE_Y)
        time.sleep(2)

        img = emulator.screencap_bgr()
        found, _ = find_template(img, TPL_ATTACK)
        if not found:
            # Not ready (defender not encamped yet or popup not stable) → dismiss and retry.
            emulator.shell("input keyevent 4")
            time.sleep(0.5)
            logger.info("attack_when_ready: Attack not available yet, waiting %ds...", poll_sec)
            time.sleep(poll_sec)
            continue

        logger.info("attack_when_ready: Attack button found — tapping Attack")
        _find_and_tap(emulator, TPL_ATTACK, "Attack")
        time.sleep(3)
        return deploy_army(emulator, army_spec)

    raise WosDispatchError(
        f"attack_when_ready: Attack button not found at X={world_x} Y={world_y} after {timeout_sec}s"
    )


def wait_for_battle_complete(emulator: WosEmulator, after: float, timeout_sec: int = 300, poll_sec: int = 5) -> bool:
    """
    Wait until a new war report appears after the given timestamp.

    Delegates polling to wait_for_new_report (which has its own poll loop).
    Returns True when battle is complete.
    Raises WosDispatchError on timeout.
    """
    from report_reader import wait_for_new_report
    logger.info("wait_for_battle_complete: waiting for new war report after %.0f", after)
    found = wait_for_new_report(emulator, tab="war", after=after, timeout_sec=timeout_sec, poll_sec=poll_sec)
    if not found:
        logger.warning("wait_for_battle_complete: no new war report detected within %ds — proceeding anyway", timeout_sec)
    return True


# ─── Main entry point ──────────────────────────────────────────────────────────
def deploy_army(emulator: WosEmulator, army_spec: dict) -> dict:
    """
    Deploy an army from the already-open troop deploy screen.

    Assumes the deploy screen is already open (Occupy or Attack has already
    been tapped by the caller). Handles hero selection, troop selection,
    and tapping the Deploy button.

    Args:
        emulator:   WosEmulator instance to operate on
        army_spec:  Army composition dict with 'heroes' and 'troops' keys

    Returns:
        dict with ok=True on success, or raises WosDispatchError.
    """
    heroes: dict = army_spec.get("heroes", {})
    troops: dict = army_spec.get("troops", {})

    if not troops:
        raise WosDispatchError("Army spec has no troops")
    if len(heroes) > 3:
        raise WosDispatchError(f"Max 3 heroes allowed, got {len(heroes)}")

    # Validate troop keys
    unknown_troops = [t for t in troops if t not in TROOP_DISPLAY_NAMES]
    if unknown_troops:
        raise WosDispatchError(f"Unknown troop type(s): {unknown_troops}. Known: {list(TROOP_DISPLAY_NAMES)}")

    # ── Step 1: Clear ALL hero slots, keeping picker open throughout ─────────
    # Open picker via Slot 1 first, then switch slot focus by tapping slot
    # buttons (WITHOUT pressing Back — Back exits the deploy screen to the map).
    logger.info("deploy_army: clearing all hero slots via picker slot-switching")
    slot_x, slot_y = _HERO_SLOTS[0]
    emulator.tap(slot_x, slot_y)
    time.sleep(2)

    for _slot_idx in range(3):
        slot_x, slot_y = _HERO_SLOTS[_slot_idx]
        logger.info("deploy_army: inspecting slot %d at (%d,%d)", _slot_idx + 1, slot_x, slot_y)
        # Switch picker focus to this slot (tap slot button while picker is open).
        # For slot 0 this is a no-op (already focused), but harmless to re-tap.
        if _slot_idx > 0:
            emulator.tap(slot_x, slot_y)
            time.sleep(1.5)

        img = emulator.screencap_bgr()
        remove_found, (rx, ry) = find_template(img, TPL_HERO_REMOVE)
        if remove_found:
            logger.info("deploy_army: slot %d has existing hero — tapping Remove at (%d,%d)", _slot_idx + 1, rx, ry)
            emulator.tap(rx, ry)
            time.sleep(1.5)
        else:
            logger.info("deploy_army: slot %d is empty — no hero to remove", _slot_idx + 1)

    # Switch back to Slot 1 so the assign loop fills from the first slot.
    logger.info("deploy_army: focusing picker on slot 1 for hero assignment")
    slot_x, slot_y = _HERO_SLOTS[0]
    emulator.tap(slot_x, slot_y)
    time.sleep(2)

    # ── Step 5: Assign heroes ─────────────────────────────────────────────────
    for slot_idx, (hero_name, _hero_levels) in enumerate(heroes.items()):
        logger.info("deploy_army: assigning hero %d/%d: %s", slot_idx + 1, len(heroes), hero_name)

        # Find and assign the hero
        _assign_hero(emulator, hero_name)
        time.sleep(1)

    # Close hero picker
    logger.info("deploy_army: closing hero picker")
    emulator.shell("input keyevent 4")
    time.sleep(1.5)

    # ── Step 5b: Withdraw All default troops (if button is visible) ───────────
    img = emulator.screencap_bgr()
    withdraw_found, (wx, wy) = find_template(img, TPL_WITHDRAW_ALL)
    if withdraw_found:
        logger.info("deploy_army: tapping Withdraw All at (%d,%d)", wx, wy)
        emulator.tap(wx, wy)
        time.sleep(1.5)
    else:
        logger.info("deploy_army: Withdraw All not visible (no auto-filled troops), skipping")

    # ── Step 6: Set troop counts ──────────────────────────────────────────────
    # OCR the deploy screen to find each troop row dynamically.
    # For lower tiers (e.g. T6 Heroic), rows may be off-screen; scroll and retry.
    def _find_row_cy(troop_rows: dict[str, int], display_name: str) -> Optional[int]:
        expected_rank, expected_type = _troop_name_parts(display_name)
        expected_norm = _normalize_troop_text(display_name)
        for ocr_text, cy in troop_rows.items():
            if ocr_text.startswith("__avail__"):
                continue
            ocr_norm = _normalize_troop_text(ocr_text)
            if ocr_norm == expected_norm:
                return cy
            if (
                _normalize_troop_text(expected_rank) in ocr_norm
                and _normalize_troop_text(expected_type) in ocr_norm
            ):
                return cy
        return None

    logger.info("deploy_army: OCR-scanning troop rows")
    troop_rows = _ocr_troop_rows(emulator)
    previous_troop_rows = None
    direction = 1

    for sim_key, count in troops.items():
        display_name = TROOP_DISPLAY_NAMES[sim_key]
        row_cy = _find_row_cy(troop_rows, display_name)

        # If not visible, scroll down through the troop list and retry.
        scroll_attempts = 0
        while row_cy is None and scroll_attempts < 12:
            logger.info("deploy_army: troop '%s' not visible — nudging troop list down (attempt %d/12)", display_name, scroll_attempts + 1)

            # Guard: ensure we're still on the deploy screen (Preset tab should be present)
            img_guard = emulator.screencap_bgr()
            preset_ok, _ = find_template(img_guard, TPL_PRESET1, threshold=0.65)
            if not preset_ok:
                raise WosDispatchError("deploy_army: lost deploy screen while searching troop rows (Preset1 not visible)")

            # If the troop rows haven't changed after the scroll, we may have reached the end of the list so reverse direction (up ↔ down).
            if troop_rows == previous_troop_rows:
                direction *= -1
                logger.info("deploy_army: troop rows unchanged after scroll — reversing scroll direction to %s", "down" if direction == 1 else "up")
            
            start_y = 815 + direction * 50
            end_y = 815 - direction * 50
            # Controlled drag inside troop list: touch → slide → stop → release.
            # Paul-calibrated gesture: 100px over 750ms (slow, low-momentum).
            # Use far-left (x=50) to avoid interacting with number sliders/controls.
            emulator.shell("input swipe 50 " + str(start_y) + " 50 " + str(end_y) + " 750")
            time.sleep(2)


            previous_troop_rows = troop_rows
            troop_rows = _ocr_troop_rows(emulator)
            
            row_cy = _find_row_cy(troop_rows, display_name)
            scroll_attempts += 1

        if row_cy is None:
            raise WosDispatchError(
                f"Troop '{display_name}' not found on deploy screen after scrolling. OCR found: {list(troop_rows.keys())}"
            )

        # Check available count — the OCR captures "/NNN" tokens at the same y as the troop name.
        # Look for a __avail__<y> key within ±10px of the row.
        avail_count = None
        for k, v in troop_rows.items():
            if k.startswith('__avail__'):
                avail_y = int(k.split('__avail__')[1])
                if abs(avail_y - row_cy) <= 10:
                    avail_count = v
                    break
        if avail_count is not None and count > avail_count:
            raise WosDispatchError(
                f"Troop '{display_name}': requested {count} but only {avail_count} available. "
                f"Reduce the testcase spec or train more troops."
            )

        _set_troop_count(emulator, display_name, count, row_cy)

    # ── Step 7: Tap Deploy ────────────────────────────────────────────────────
    logger.info("deploy_army: tapping Deploy button")
    _find_and_tap(emulator, TPL_DEPLOY_BTN, "Deploy")
    time.sleep(3)

    logger.info("deploy_army: ✅ army dispatched")
    return {"ok": True, "heroes": list(heroes.keys()), "troops": troops, "time": time.time()}
