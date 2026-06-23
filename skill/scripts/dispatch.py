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
import math
import re
import time
from datetime import datetime, timezone
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
_HERO_TEMPLATE_ALIASES = {
    # The simulator/account data uses Sergey, while the current in-game picker
    # card is represented by the legacy Sergei template.
    "Sergey": "Sergei",
}

# ─── Templates ─────────────────────────────────────────────────────────────────
TPL_OCCUPY            = str(_TPL / "tile_occupy_button.png")
TPL_ATTACK            = str(_TPL / "tile_attack_button.png")
TPL_RECALL            = str(_TPL / "tile_recall_button.png")
TPL_CAMP_RECALL       = str(_TPL / "camp_recall_button.png")
TPL_RECALL_CONFIRM    = str(_TPL / "recall_confirm_button.png")
TPL_PRESET1           = str(_TPL / "deploy_preset1_tab.png")
TPL_SAVE_FLAG         = str(_TPL / "save_flag.png")
TPL_FLAG_7            = str(_TPL / "flag_7.png")
TPL_FLAG_7_ALERT      = str(_TPL / "flag_7_alert.png")
TPL_FLAG_7_SELECTED   = str(_TPL / "flag_7_selected.png")
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
_HERO_PICKER_AREA   = (0, 560, 720, 380)  # x, y, w, h: scrollable hero-grid area
_HERO_PICKER_UNCHANGED_MEAN_THRESHOLD = 1.5
_HERO_PICKER_DIAG_DIR = Path("/tmp/wosctl_hero_picker_diag")
_TEMPLATE_MISS_DIAG_DIR = _SKILL_DIR / "tmp" / "wosctl_template_misses"

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

_RELOCATE_DISTANCE_THRESHOLD = 30.0

# Candidate empty tiles around the target after the map has been centred on the
# defender's occupied tile. Avoid the exact centre because that is the defender.
_TELEPORT_PROBE_COORDS = [
    (250, 560), (470, 560),
    (250, 720), (470, 720),
    (360, 500), (360, 780),
    (180, 640), (540, 640),
    (150, 500), (570, 500),
    (150, 780), (570, 780),
]

# ─── Exceptions ────────────────────────────────────────────────────────────────
class WosDispatchError(WosError):
    """Raised when dispatch cannot complete."""


class WosTroopAvailabilityError(WosDispatchError):
    """Raised when the requested army cannot be filled with available troops."""


class WosPresetTroopShortageError(WosTroopAvailabilityError):
    """Raised when a saved preset shows the red troop-shortage badge."""


# ─── Internal helpers ──────────────────────────────────────────────────────────
def _template_miss_path(label: str, template_path: str) -> Path:
    safe_label = re.sub(r"[^a-zA-Z0-9_.-]+", "_", label).strip("._") or "template"
    template_stem = Path(template_path).stem
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    return _TEMPLATE_MISS_DIAG_DIR / f"{timestamp}_{safe_label}_{template_stem}.png"


def _find_and_tap(
    emulator: WosEmulator,
    template_path: str,
    label: str,
    threshold: float = 0.85,
    attempts: int = 3,
    retry_delay: float = 0.6,
) -> tuple[int, int]:
    """Screencap, find template, tap it. Raises WosDispatchError if not found."""
    last_img: np.ndarray | None = None
    for attempt in range(1, max(1, attempts) + 1):
        img = emulator.screencap_bgr()
        last_img = img
        found, (cx, cy) = find_template(img, template_path, threshold=threshold)
        if found:
            logger.info("%s: tapping (%d,%d)", label, cx, cy)
            emulator.tap(cx, cy)
            return cx, cy
        if attempt < attempts:
            logger.warning(
                "%s: template not found on attempt %d/%d (%s); retrying",
                label,
                attempt,
                attempts,
                template_path,
            )
            time.sleep(retry_delay)

    screenshot_path = _template_miss_path(label, template_path)
    score = 0.0
    if last_img is not None:
        try:
            _TEMPLATE_MISS_DIAG_DIR.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(screenshot_path), last_img)
        except Exception as exc:
            logger.warning("%s: could not save template-miss screenshot: %s", label, exc)
        try:
            score = _template_score(last_img, template_path)
        except Exception as exc:
            logger.warning("%s: could not score missed template %s: %s", label, template_path, exc)
    raise WosDispatchError(
        f"{label}: template not found after {attempts} attempts "
        f"({template_path}; score={score:.3f}; threshold={threshold:.3f}; screenshot={screenshot_path})"
    )


def _template_score(screenshot_bgr: np.ndarray, template_path: str) -> float:
    template = cv2.imread(template_path)
    if template is None:
        raise FileNotFoundError(f"Template not found: {template_path}")
    result = cv2.matchTemplate(screenshot_bgr, template, cv2.TM_CCOEFF_NORMED)
    return float(cv2.minMaxLoc(result)[1])


def _hero_picker_crop(img: np.ndarray) -> tuple[np.ndarray, tuple[int, int]]:
    x, y, w, h = _HERO_PICKER_AREA
    return img[y:y + h, x:x + w], (x, y)


def _find_template_in_hero_picker_area(
    img: np.ndarray,
    template_path: str,
    threshold: float = 0.75,
) -> tuple[bool, tuple[int, int]]:
    crop, (x_offset, y_offset) = _hero_picker_crop(img)
    found, (cx, cy) = find_template(crop, template_path, threshold=threshold)
    if not found:
        return False, (0, 0)
    return True, (cx + x_offset, cy + y_offset)


def _verify_preset7_selected(emulator: WosEmulator) -> None:
    """Fail unless deploy preset slot 7 is visibly selected."""
    img = emulator.screencap_bgr()
    found, _ = find_template(img, TPL_FLAG_7_SELECTED, threshold=0.70)
    if not found:
        raise WosDispatchError("Preset 7 did not show selected state after tap")


def _select_preset7(emulator: WosEmulator, label: str = "Preset7") -> None:
    img = emulator.screencap_bgr()
    matched_template = None
    templates = (
        ((TPL_FLAG_7_ALERT, 0.85), (TPL_FLAG_7, 0.85))
        if label == "LoadPreset7"
        else ((TPL_FLAG_7, 0.85), (TPL_FLAG_7_ALERT, 0.85))
    )
    for template_path, threshold in templates:
        found, (cx, cy) = find_template(img, template_path, threshold=threshold)
        if found:
            matched_template = Path(template_path).name
            if label == "LoadPreset7" and template_path == TPL_FLAG_7_ALERT:
                screenshot_path = f"/tmp/wosctl_{label}_preset7_troop_shortage.png"
                cv2.imwrite(screenshot_path, img)
                flag_score = _template_score(img, TPL_FLAG_7)
                alert_score = _template_score(img, TPL_FLAG_7_ALERT)
                selected_score = _template_score(img, TPL_FLAG_7_SELECTED)
                raise WosPresetTroopShortageError(
                    f"{label}: preset 7 has red troop-shortage badge; "
                    f"not enough available troops for the saved preset "
                    f"(flag_7 score={flag_score:.3f} threshold=0.850; "
                    f"flag_7_alert score={alert_score:.3f} threshold=0.850; "
                    f"selected score={selected_score:.3f} threshold=0.700; "
                    f"screenshot={screenshot_path})"
                )
            break
    if matched_template is None:
        selected, _ = find_template(img, TPL_FLAG_7_SELECTED, threshold=0.70)
        if selected:
            logger.info("%s: preset 7 already selected", label)
            return
        screenshot_path = f"/tmp/wosctl_{label}_preset7_not_found.png"
        cv2.imwrite(screenshot_path, img)
        flag_score = _template_score(img, TPL_FLAG_7)
        alert_score = _template_score(img, TPL_FLAG_7_ALERT)
        selected_score = _template_score(img, TPL_FLAG_7_SELECTED)
        raise WosDispatchError(
            f"{label}: preset 7 flag not found "
            f"(flag_7 score={flag_score:.3f} threshold=0.850; "
            f"flag_7_alert score={alert_score:.3f} threshold=0.850; "
            f"selected score={selected_score:.3f} threshold=0.700; "
            f"screenshot={screenshot_path})"
        )
    logger.info("%s: tapping (%d,%d) via %s", label, cx, cy, matched_template)
    emulator.tap(cx, cy)
    time.sleep(0.8)
    _verify_preset7_selected(emulator)


def _save_preset7(emulator: WosEmulator) -> None:
    logger.info("deploy_army: saving configured army to preset slot 7")
    _find_and_tap(emulator, TPL_SAVE_FLAG, "SaveFlag")
    time.sleep(1)
    _select_preset7(emulator, "SaveFlagPreset7")
    logger.info("deploy_army: confirming preset slot 7 save")
    _find_and_tap(emulator, TPL_RECALL_CONFIRM, "SaveFlagConfirm", threshold=0.80)
    time.sleep(1)


def _deploy_preset7(emulator: WosEmulator) -> dict:
    logger.info("deploy_army: loading preset slot 7")
    _select_preset7(emulator, "LoadPreset7")
    logger.info("deploy_army: tapping Deploy button")
    _find_and_tap(emulator, TPL_DEPLOY_BTN, "Deploy")
    time.sleep(3)
    logger.info("deploy_army: ✅ preset 7 army dispatched")
    return {"ok": True, "preset": 7, "time": time.time()}


def _hero_template_path(hero_name: str) -> str:
    template_name = _HERO_TEMPLATE_ALIASES.get(hero_name, hero_name)
    tpl_path = str(_HEROES_DIR / f"{template_name.replace(' ', '_')}.png")
    if not Path(tpl_path).exists():
        raise WosDispatchError(f"No template for hero '{hero_name}' at {tpl_path}")
    return tpl_path


def _find_hero_on_screen(emulator: WosEmulator, hero_name: str) -> Optional[tuple[int, int]]:
    """Return tap coords if hero template found on current screen, else None."""
    tpl_path = _hero_template_path(hero_name)
    img = emulator.screencap_bgr()
    found, (cx, cy) = _find_template_in_hero_picker_area(img, tpl_path, threshold=0.75)
    return (cx, cy) if found else None


def _find_visible_requested_hero(
    emulator: WosEmulator,
    hero_names: list[str],
) -> Optional[tuple[str, tuple[int, int]]]:
    """Inspect the current picker screen for any requested hero."""
    img = emulator.screencap_bgr()
    for hero_name in hero_names:
        tpl_path = _hero_template_path(hero_name)
        found, (cx, cy) = _find_template_in_hero_picker_area(img, tpl_path, threshold=0.75)
        if found:
            return hero_name, (cx, cy)
    return None


def _tap_assign_for_visible_hero(emulator: WosEmulator, hero_name: str, coords: tuple[int, int]) -> None:
    cx, cy = coords
    logger.info("assign_hero '%s': found at (%d,%d), tapping", hero_name, cx, cy)
    emulator.tap(cx, cy)
    time.sleep(0.8)
    _find_and_tap(emulator, TPL_HERO_ASSIGN, f"Assign ({hero_name})")
    time.sleep(1.5)
    logger.info("assign_hero '%s': assigned", hero_name)


def _focus_hero_slot(emulator: WosEmulator, slot_idx: int) -> None:
    if slot_idx < 0 or slot_idx >= len(_HERO_SLOTS):
        raise WosDispatchError(f"Hero slot index out of range: {slot_idx}")
    slot_x, slot_y = _HERO_SLOTS[slot_idx]
    logger.info("assign_heroes: focusing empty hero slot %d at (%d,%d)", slot_idx + 1, slot_x, slot_y)
    emulator.tap(slot_x, slot_y)
    time.sleep(1.5)


def _capture_hero_picker_area(emulator: WosEmulator) -> np.ndarray:
    img = emulator.screencap_bgr()
    x, y, w, h = _HERO_PICKER_AREA
    return img[y:y + h, x:x + w].copy()


def _hero_picker_areas_changed(before: np.ndarray, after: np.ndarray) -> bool:
    if before.shape != after.shape:
        return True
    mean_diff = float(np.mean(cv2.absdiff(before, after)))
    return mean_diff > _HERO_PICKER_UNCHANGED_MEAN_THRESHOLD


def _write_hero_picker_diagnostics(
    emulator: WosEmulator,
    hero_names: list[str],
    reason: str,
) -> Path:
    img = emulator.screencap_bgr()
    crop, _ = _hero_picker_crop(img)
    safe_reason = re.sub(r"[^a-z0-9_]+", "_", reason.lower()).strip("_") or "unknown"
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out_dir = _HERO_PICKER_DIAG_DIR / f"{stamp}_{safe_reason}"
    out_dir.mkdir(parents=True, exist_ok=True)
    screenshot_path = out_dir / "screen.png"
    crop_path = out_dir / "picker_crop.png"
    cv2.imwrite(str(screenshot_path), img)
    cv2.imwrite(str(crop_path), crop)

    scores: list[str] = []
    for hero_name in hero_names:
        tpl_path = _hero_template_path(hero_name)
        score = _template_score(crop, tpl_path)
        template_name = Path(tpl_path).stem.replace("_", " ")
        label = hero_name if template_name == hero_name else f"{hero_name}({template_name})"
        scores.append(f"{label}={score:.3f}")
    logger.warning(
        "hero picker diagnostics (%s): screenshot=%s crop=%s area=%s template_scores=%s",
        reason,
        screenshot_path,
        crop_path,
        _HERO_PICKER_AREA,
        ", ".join(scores),
    )
    return out_dir


def _scroll_hero_list(emulator: WosEmulator, direction: str = "up") -> bool:
    """
    Scroll the hero picker list.
    direction='up'  → reveals earlier heroes (drag finger downward)
    direction='down'→ reveals later heroes (drag finger upward)

    Returns True when the visible picker grid changed after the swipe.
    """
    before = _capture_hero_picker_area(emulator)
    if direction == "up":
        fy, ty = _SCROLL_UP_FROM_Y, _SCROLL_UP_TO_Y
    else:
        fy, ty = _SCROLL_DOWN_FROM_Y, _SCROLL_DOWN_TO_Y
    emulator.shell(f"input swipe {_SCROLL_X} {fy} {_SCROLL_X} {ty} {_HERO_SWIPE_DUR_MS}")
    time.sleep(1)
    after = _capture_hero_picker_area(emulator)
    changed = _hero_picker_areas_changed(before, after)
    if not changed:
        logger.info("hero picker scroll %s did not change visible hero area", direction)
    return changed


def _assign_hero(emulator: WosEmulator, hero_name: str, max_scrolls: int = 10) -> None:
    """
    Find hero by template (scrolling if needed) and tap Assign.
    Scrolls down first, then if not found scrolls back up from the bottom.
    """
    # Phase 1: scroll down to find lower-ranked heroes
    for scroll_num in range(max_scrolls):
        coords = _find_hero_on_screen(emulator, hero_name)
        if coords:
            _tap_assign_for_visible_hero(emulator, hero_name, coords)
            return
        logger.info("assign_hero '%s': not visible (scroll %d/%d down), scrolling down", hero_name, scroll_num + 1, max_scrolls)
        _scroll_hero_list(emulator, direction="down")

    # Phase 2: scroll back up (hero may be above current position)
    for scroll_num in range(max_scrolls * 2):
        coords = _find_hero_on_screen(emulator, hero_name)
        if coords:
            _tap_assign_for_visible_hero(emulator, hero_name, coords)
            return
        logger.info("assign_hero '%s': not visible (scroll %d/%d up), scrolling up", hero_name, scroll_num + 1, max_scrolls * 2)
        _scroll_hero_list(emulator, direction="up")

    raise WosDispatchError(f"Hero '{hero_name}' not found after {max_scrolls * 3} scrolls (down+up)")


def _assign_heroes(emulator: WosEmulator, hero_names: list[str], max_scrolls: int = 10) -> None:
    """
    Assign requested heroes from the open picker in spec order.

    Probe fixtures depend on the target hero landing in the intended slot. Do
    not opportunistically assign another requested hero just because it is
    visible first; that can leave the picker scrolled away from an earlier,
    higher-priority hero.
    """
    if not hero_names:
        return

    for slot_idx, hero_name in enumerate(hero_names):
        if slot_idx > 0:
            _focus_hero_slot(emulator, slot_idx)
        logger.info(
            "assign_heroes: assigning requested hero %d/%d in spec order: %s",
            slot_idx + 1,
            len(hero_names),
            hero_name,
        )
        try:
            _assign_hero(emulator, hero_name, max_scrolls=max_scrolls)
        except WosDispatchError:
            _write_hero_picker_diagnostics(emulator, [hero_name], f"not_found_slot_{slot_idx + 1}")
            raise


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
    # Crop troop section (below hero slots, above deploy button).
    # Extended to 610px height (490:1100) to capture bottom-edge rows
    # such as T6 Heroic troops which appear at the bottom of the list.
    troop_area = img[490:1100, 0:720]
    result, _ = ocr(troop_area)
    rows = _troop_rows_from_ocr_lines(result or [], y_offset=490)
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
    goto_world_map(emulator)


def _parse_world_coords_from_text(text: str) -> tuple[int, int] | None:
    """Parse a WOS world coordinate pair from OCR text."""
    normalized = str(text).replace("：", ":")
    mx = re.search(r"\bX\s*:\s*(\d{2,4})\b", normalized, flags=re.IGNORECASE)
    my = re.search(r"\bY\s*:\s*(\d{2,4})\b", normalized, flags=re.IGNORECASE)
    if not (mx and my):
        return None

    x, y = int(mx.group(1)), int(my.group(1))
    if 100 <= x <= 1100 and 100 <= y <= 1100:
        return x, y
    return None


def _ocr_current_world_coords(emulator: WosEmulator) -> tuple[int, int] | None:
    """Read the current map coordinates shown to the right of the search icon."""
    try:
        from ocr import RapidOCR
        from navigation import TEMPLATE_COORD_SEARCH_ICON
    except ImportError as e:
        raise WosDispatchError(f"RapidOCR not available: {e}")

    img = emulator.screencap_bgr()
    found, (search_x, search_y) = find_template(img, TEMPLATE_COORD_SEARCH_ICON)
    if not found:
        raise WosDispatchError("current coord OCR: coordinate search icon not found on world map")

    h, w = img.shape[:2]
    x1 = max(0, search_x + 20)
    x2 = min(w, search_x + 330)
    y1 = max(0, search_y - 45)
    y2 = min(h, search_y + 45)
    crop = img[y1:y2, x1:x2]

    ocr_result, _ = RapidOCR()(crop)
    lines = []
    if ocr_result:
        for _box, text, conf in ocr_result:
            lines.append((str(text), float(conf)))
            coords = _parse_world_coords_from_text(str(text))
            if coords:
                logger.info("current coord OCR: parsed X=%d Y=%d from %r", coords[0], coords[1], text)
                return coords

        joined = " ".join(text for text, _conf in lines)
        coords = _parse_world_coords_from_text(joined)
        if coords:
            logger.info("current coord OCR: parsed X=%d Y=%d from joined OCR", coords[0], coords[1])
            return coords

    logger.warning(
        "current coord OCR: could not parse coordinates from region right of search icon; lines=%s",
        lines,
    )
    return None


def _find_ocr_text_center(img_bgr: np.ndarray, pattern: str, *, min_conf: float = 0.35) -> tuple[int, int] | None:
    """Return the centre of the first OCR text box matching pattern."""
    try:
        from ocr import RapidOCR
    except ImportError as e:
        raise WosDispatchError(f"RapidOCR not available: {e}")

    regex = re.compile(pattern, flags=re.IGNORECASE)
    result, _ = RapidOCR()(img_bgr)
    if not result:
        return None

    for box, text, conf in result:
        if float(conf) < min_conf or not regex.search(str(text)):
            continue
        xs = [point[0] for point in box]
        ys = [point[1] for point in box]
        return int(sum(xs) / len(xs)), int(sum(ys) / len(ys))
    return None


def _tap_ocr_text(emulator: WosEmulator, pattern: str, label: str) -> bool:
    img = emulator.screencap_bgr()
    center = _find_ocr_text_center(img, pattern)
    if center is None:
        logger.info("%s: OCR text %r not found", label, pattern)
        return False
    x, y = center
    logger.info("%s: tapping OCR text at (%d,%d)", label, x, y)
    emulator.tap(x, y)
    return True


def _try_teleport_near_target(emulator: WosEmulator) -> bool:
    """Try nearby empty tiles until WOS offers and confirms a green Teleport placement."""
    for tap_x, tap_y in _TELEPORT_PROBE_COORDS:
        logger.info("relocate: probing nearby tile (%d,%d)", tap_x, tap_y)
        emulator.tap(tap_x, tap_y)
        time.sleep(2)

        if not _tap_ocr_text(emulator, r"\bTeleport\b", "relocate popup"):
            emulator.shell("input keyevent 4")
            time.sleep(0.5)
            continue

        time.sleep(2)
        if _tap_ocr_text(emulator, r"\bTeleport\b", "relocate confirm"):
            time.sleep(5)
            logger.info("relocate: teleport confirmed near target")
            return True

        logger.info("relocate: placement not confirmable at (%d,%d), trying another tile", tap_x, tap_y)
        emulator.shell("input keyevent 4")
        time.sleep(0.8)

    return False


def _ensure_attacker_near_target(emulator: WosEmulator, world_x: int, world_y: int) -> bool:
    """Relocate the attacker city near the target when the march would be excessive."""
    from navigation import goto_coord, goto_world_map

    goto_world_map(emulator)
    time.sleep(1)

    current = _ocr_current_world_coords(emulator)
    if current is None:
        logger.warning("relocate: skipping far-distance check because current coords could not be read")
        return False

    current_x, current_y = current
    distance = math.hypot(current_x - world_x, current_y - world_y)
    logger.info(
        "relocate: attacker current X=%d Y=%d, target X=%d Y=%d, straight-line distance=%.1f",
        current_x, current_y, world_x, world_y, distance,
    )
    if distance <= _RELOCATE_DISTANCE_THRESHOLD:
        return False

    logger.warning(
        "relocate: distance %.1f exceeds %.1f; attempting nearby teleport before attack",
        distance, _RELOCATE_DISTANCE_THRESHOLD,
    )
    goto_coord(emulator, world_x, world_y)
    time.sleep(1)
    if not _try_teleport_near_target(emulator):
        raise WosDispatchError(
            f"relocate: target X={world_x} Y={world_y} is {distance:.1f} tiles away "
            "and no nearby teleport tile could be confirmed"
        )
    return True

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
    preset_mode: Optional[str] = None,
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
        _ensure_attacker_near_target(emulator, world_x, world_y)
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
        return deploy_army(emulator, army_spec, preset_mode=preset_mode)

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
def deploy_army(emulator: WosEmulator, army_spec: dict, preset_mode: Optional[str] = None) -> dict:
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
    if preset_mode not in (None, "save", "load"):
        raise WosDispatchError(f"Unsupported preset mode: {preset_mode!r}")

    if preset_mode == "load":
        return _deploy_preset7(emulator)

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
    hero_names = list(heroes.keys())
    if hero_names:
        logger.info("deploy_army: assigning %d hero(s): %s", len(hero_names), hero_names)
        _assign_heroes(emulator, hero_names)
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
            try:
                debug_path = f"/tmp/wosctl_troop_not_found_{display_name.replace(' ', '_')}.png"
                import cv2 as _cv2
                _cv2.imwrite(debug_path, emulator.screencap_bgr())
                logger.warning("deploy_army: saved troop-not-found debug screenshot to %s", debug_path)
            except Exception as _dbg_exc:
                logger.warning("deploy_army: could not save debug screenshot: %s", _dbg_exc)
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
            raise WosTroopAvailabilityError(
                f"Troop '{display_name}': requested {count} but only {avail_count} available. "
                f"Reduce the testcase spec or train more troops."
            )

        _set_troop_count(emulator, display_name, count, row_cy)

    if preset_mode == "save":
        _save_preset7(emulator)

    # ── Step 7: Tap Deploy ────────────────────────────────────────────────────
    logger.info("deploy_army: tapping Deploy button")
    _find_and_tap(emulator, TPL_DEPLOY_BTN, "Deploy")
    time.sleep(3)

    logger.info("deploy_army: ✅ army dispatched")
    return {"ok": True, "heroes": list(heroes.keys()), "troops": troops, "time": time.time()}
