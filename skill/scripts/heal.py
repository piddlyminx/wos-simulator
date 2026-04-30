"""
heal.py — Alliance-assisted troop healing automation for wosctl.

Verified flow (manually stepped through 2026-03-24):

1. Check current alliance (OCR). If needed, switch to the configured heal alliance.
2. Template-match hospital icon on world map → tap to open Heal Injured popup.
3. Double-tap Quick Select (rapid, <0.1s apart) → all count pills reset to 0.
4. Template-match first zero pill → tap → clear → type 85 → Enter.
5. Loop:
       template-match Heal button
       if not found → all troops healed, exit
       tap Heal  (starts 85-troop heal, Help appears at same coords)
       sleep 0.5s
       tap same coords again  (taps Help → instantly completes, auto-selects next 85)
       sleep 0.5s

Alliance templates needed (to be clipped from live screenshots):
  nav_alliance_button.png, alliance_settings_cog.png,
  alliance_leave_button.png, alliance_leave_confirm.png
"""
from __future__ import annotations

import logging
import re
import time
from pathlib import Path
from typing import TYPE_CHECKING

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
from alliance import ensure_in_alliance

logger = logging.getLogger(__name__)

# ─── Templates ─────────────────────────────────────────────────────────────────
_TPL = Path(__file__).resolve().parent.parent / "templates"

TPL_HOSPITAL_ICON      = str(_TPL / "heal_hospital_icon.png")
TPL_QUICK_SELECT       = str(_TPL / "heal_quick_select_btn.png")
TPL_ZERO_PILL          = str(_TPL / "heal_zero_pill.png")
TPL_HEAL_BTN           = str(_TPL / "heal_heal_btn.png")
TPL_HEAL_INJURED_TITLE = str(_TPL / "heal_injured.png")

HEAL_BATCH_SIZE = 85

# Hospital icon search region on world map (x1, y1, x2, y2)
_HOSPITAL_SEARCH_REGION = (440, 980, 680, 1090)

# Template match thresholds
_THRESH_HOSPITAL = 0.80   # greyscale match
_THRESH_BUTTONS  = 0.85
_THRESH_PILL     = 0.80
_HEAL_PILL_SEARCH_REGION = (430, 280, 640, 950)

# ─── Exceptions ────────────────────────────────────────────────────────────────
class WosHealError(WosError):
    """Raised when healing cannot complete."""


# ─── RapidOCR helper ───────────────────────────────────────────────────────────
_rapid_ocr_instance = None

def _get_rapid_ocr():
    global _rapid_ocr_instance
    if _rapid_ocr_instance is None:
        from ocr import RapidOCR
        _rapid_ocr_instance = RapidOCR()
    return _rapid_ocr_instance


# ─── Template helpers ───────────────────────────────────────────────────────────
def _find_in_region(
    img: np.ndarray,
    tpl_path: str,
    region: tuple[int, int, int, int],
    threshold: float = 0.80,
    grayscale: bool = False,
) -> tuple[bool, tuple[int, int]]:
    """Search for template within a sub-region. Returns (found, (abs_x, abs_y))."""
    x1, y1, x2, y2 = region
    crop = img[y1:y2, x1:x2]
    tpl  = cv2.imread(tpl_path)
    if tpl is None:
        raise FileNotFoundError(f"Template not found: {tpl_path}")
    if grayscale:
        crop = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        tpl  = cv2.cvtColor(tpl,  cv2.COLOR_BGR2GRAY)
    th, tw = tpl.shape[:2]
    result = cv2.matchTemplate(crop, tpl, cv2.TM_CCOEFF_NORMED)
    _, max_val, _, max_loc = cv2.minMaxLoc(result)
    if max_val < threshold:
        return False, (0, 0)
    abs_x = x1 + max_loc[0] + tw // 2
    abs_y = y1 + max_loc[1] + th // 2
    logger.debug("_find_in_region %s score=%.3f abs=(%d,%d)", tpl_path, max_val, abs_x, abs_y)
    return True, (abs_x, abs_y)


# ─── OCR helper ────────────────────────────────────────────────────────────────
def _ocr_region_items(img: np.ndarray, region: tuple[int, int, int, int]) -> list[str]:
    x1, y1, x2, y2 = region
    crop = img[y1:y2, x1:x2]
    ocr = _get_rapid_ocr()
    result, _ = ocr(crop)
    return [r[1] for r in result] if result else []


def _ocr_region(img: np.ndarray, region: tuple[int, int, int, int]) -> str:
    return " ".join(_ocr_region_items(img, region)).strip()


# ─── Hospital ──────────────────────────────────────────────────────────────────
# def _open_hospital(emulator: WosEmulator, max_attempts: int = 5) -> None:
#     """
#     On the world map, template-match the hospital red-cross icon and tap it.
#     Searches in _HOSPITAL_SEARCH_REGION using greyscale matching.
#     Raises WosHealError if not found after max_attempts.
#     """
#     for attempt in range(1, max_attempts + 1):
#         img = emulator.screencap_bgr()
#         found, (cx, cy) = _find_in_region(
#             img, TPL_HOSPITAL_ICON, _HOSPITAL_SEARCH_REGION,
#             threshold=_THRESH_HOSPITAL, grayscale=True,
#         )
#         if found:
#             logger.info("_open_hospital: icon at (%d,%d) attempt %d", cx, cy, attempt)
#             emulator.tap(cx, cy)
#             time.sleep(2)
#             return
#         logger.warning("_open_hospital: not found (attempt %d/%d)", attempt, max_attempts)
#         time.sleep(1)
#     raise WosHealError("Hospital icon not found on world map")


# ─── Quick Select double-tap ────────────────────────────────────────────────────
def _double_tap_quick_select(emulator: WosEmulator, max_attempts: int = 3) -> None:
    """
    Template-match Quick Select and toggle until the visible rows are all zero.

    In practice one tap can leave the popup in the "all selected / max counts"
    state, while a second tap flips it back to zero. So do not trust a blind
    double-tap; inspect the visible pill state after each tap and stop only when
    at least three visible zero-count boxes are present.

    Raises WosHealError if the button is not found or the visible rows never
    reach the zero state after max_attempts tap-pairs.
    """
    img = emulator.screencap_bgr()
    found, (cx, cy) = find_template(img, TPL_QUICK_SELECT, threshold=_THRESH_BUTTONS)
    if not found:
        raise WosHealError("Quick Select button not found")

    def _visible_zero_count() -> int:
        img_now = emulator.screencap_bgr()
        return len(_find_zero_pill_matches(img_now))

    for attempt in range(1, max_attempts + 1):
        zero_count = _visible_zero_count()
        logger.info(
            "_double_tap_quick_select: pre-attempt %d visible zero-pill count = %d",
            attempt,
            zero_count,
        )
        if zero_count >= 3:
            logger.info("_double_tap_quick_select: visible pills reset to 0 ✓")
            return

        logger.info("_double_tap_quick_select: attempt %d first tap at (%d,%d)", attempt, cx, cy)
        emulator.tap(cx, cy)
        time.sleep(0.6)
        zero_count = _visible_zero_count()
        logger.info(
            "_double_tap_quick_select: visible zero-pill count after first tap %d = %d",
            attempt,
            zero_count,
        )
        if zero_count >= 3:
            logger.info("_double_tap_quick_select: visible pills reset to 0 ✓")
            return

        logger.info("_double_tap_quick_select: attempt %d second tap at (%d,%d)", attempt, cx, cy)
        emulator.tap(cx, cy)
        time.sleep(0.8)
        zero_count = _visible_zero_count()
        logger.info(
            "_double_tap_quick_select: visible zero-pill count after second tap %d = %d",
            attempt,
            zero_count,
        )
        if zero_count >= 3:
            logger.info("_double_tap_quick_select: visible pills reset to 0 ✓")
            return

        logger.warning(
            "_double_tap_quick_select: visible pills still not reset after attempt %d, retrying",
            attempt,
        )

    raise WosHealError(
        "Quick Select double-tap did not reset the visible pills to 0 after %d attempts"
        % max_attempts
    )


# ─── Find first pill ───────────────────────────────────────────────────────────
# def _find_first_pill(emulator: WosEmulator) -> tuple[int, int]:
#     """
#     Find the first zero pill on the Heal Injured popup via template match.
#     Returns (cx, cy). Raises WosHealError if not found.
#     """
#     img = emulator.screencap_bgr()
#     found, (cx, cy) = find_template(img, TPL_ZERO_PILL, threshold=_THRESH_PILL)
#     if not found:
#         raise WosHealError("Zero pill input not found after Quick Select")
#     logger.info("_find_first_pill: found at (%d,%d)", cx, cy)
#     return cx, cy


def _find_zero_pill_matches(img: np.ndarray, max_matches: int = 6) -> list[tuple[int, int, float]]:
    """Return visible zero-count pill boxes sorted top-to-bottom."""
    x1, y1, x2, y2 = _HEAL_PILL_SEARCH_REGION
    crop = img[y1:y2, x1:x2]
    tpl = cv2.imread(TPL_ZERO_PILL)
    if tpl is None:
        raise FileNotFoundError(f"Template not found: {TPL_ZERO_PILL}")

    th, tw = tpl.shape[:2]
    result = cv2.matchTemplate(crop, tpl, cv2.TM_CCOEFF_NORMED)
    ys, xs = np.where(result >= _THRESH_PILL)
    pts = sorted(
        [(int(x), int(y), float(result[y, x])) for y, x in zip(ys, xs)],
        key=lambda item: item[2],
        reverse=True,
    )

    picked: list[tuple[int, int, float]] = []
    for rel_x, rel_y, score in pts:
        abs_x = x1 + rel_x + tw // 2
        abs_y = y1 + rel_y + th // 2
        if any(abs(abs_x - px) <= tw // 2 and abs(abs_y - py) <= th // 2 for px, py, _ in picked):
            continue
        picked.append((abs_x, abs_y, score))
        if len(picked) >= max_matches:
            break

    picked.sort(key=lambda item: item[1])
    return picked


def _extract_row_injured_count(img: np.ndarray, cx: int, cy: int) -> int | None:
    """OCR the row label above a zero-count box and return the visible injured count."""
    candidate_regions = [
        (max(0, cx - 350), max(0, cy - 115), max(0, cx - 10), max(0, cy - 45)),
        (max(0, cx - 380), max(0, cy - 125), min(img.shape[1], cx + 10), max(0, cy - 35)),
    ]

    best_value: int | None = None
    best_text = ""
    for region in candidate_regions:
        items = _ocr_region_items(img, region)
        filtered_items = [item for item in items if "/" not in item]
        text = " | ".join(filtered_items or items)
        values = []
        for item in (filtered_items or items):
            item_values = [
                int(digits)
                for digits in ("".join(ch for ch in token if ch.isdigit()) for token in re.findall(r"\d[\d.,]*", item))
                if digits
            ]
            if item_values:
                values.append(item_values[-1])
        if values:
            value = values[-1]
            if best_value is None or len(text) > len(best_text):
                best_value = value
                best_text = text

    logger.info(
        "_extract_row_injured_count: row at (%d,%d) visible_count=%s text=%r",
        cx,
        cy,
        best_value,
        best_text,
    )
    return best_value


def _find_best_pill_for_batch(img: np.ndarray, count: int) -> tuple[int, int]:
    """Pick a visible zero-count box whose row has at least ``count`` injured troops."""
    pills = _find_zero_pill_matches(img)
    if not pills:
        raise WosHealError("Zero pill input not found after Quick Select")

    best_visible: tuple[int, int, int] | None = None
    for cx, cy, score in pills:
        visible_count = _extract_row_injured_count(img, cx, cy)
        logger.info(
            "_find_best_pill_for_batch: candidate (%d,%d) score=%.3f visible_count=%s",
            cx,
            cy,
            score,
            visible_count,
        )
        if visible_count is not None and (best_visible is None or visible_count > best_visible[2]):
            best_visible = (cx, cy, visible_count)
        if visible_count is not None and visible_count >= count:
            logger.info(
                "_find_best_pill_for_batch: selected (%d,%d) with visible_count=%d",
                cx,
                cy,
                visible_count,
            )
            return cx, cy

    if best_visible is not None:
        raise WosHealError(
            f"No visible heal row has at least {count} injured troops "
            f"(best visible row has {best_visible[2]})"
        )

    raise WosHealError("Could not read injured troop counts for any visible heal row")


# ─── Enter batch size ───────────────────────────────────────────────────────────
def _enter_batch_size(emulator: WosEmulator, count: int, max_attempts: int = 3) -> None:
    """
    Find a visible zero-count pill on a row with at least ``count`` injured troops,
    tap it, type count, Enter.
    OCRs the pill region after entry to verify the value was entered correctly.
    Retries up to max_attempts times if not.
    """
    img0 = emulator.screencap_bgr()
    cx, cy = _find_best_pill_for_batch(img0, count)
    logger.info("_enter_batch_size: pill at (%d,%d) count=%d", cx, cy, count)

    tpl = cv2.imread(TPL_ZERO_PILL)
    th, tw = tpl.shape[:2]
    # Pill region: use template dimensions centred on match coords
    pill_region = (cx - tw // 2, cy - th // 2, cx + tw // 2, cy + th // 2)

    for attempt in range(1, max_attempts + 1):
        emulator.tap(cx, cy)
        time.sleep(0.5)
        emulator.shell(f"input text {count}")
        time.sleep(0.3)
        emulator.shell("input keyevent 66")  # Enter
        time.sleep(0.5)

        # OCR the pill region to verify
        img = emulator.screencap_bgr()
        pill_text = _ocr_region(img, pill_region).strip().replace(",", "")
        logger.info("_enter_batch_size: attempt %d — pill OCR=%r", attempt, pill_text)
        # Accept exact match or OCR value within 2 of target (handles font/digit misreads)
        ocr_ok = str(count) in pill_text
        if not ocr_ok:
            try:
                ocr_val = int("".join(c for c in pill_text if c.isdigit()))
                ocr_ok = abs(ocr_val - count) <= 2
            except (ValueError, TypeError):
                pass
        if ocr_ok:
            logger.info("_enter_batch_size: verified ~%d in pill (OCR=%r) ✓", count, pill_text)
            return
        logger.warning("_enter_batch_size: expected %d, got %r — retrying", count, pill_text)

    raise WosHealError(f"Failed to enter {count} into pill after {max_attempts} attempts")


def _find_hospital_icon(emulator: WosEmulator, attempts: int = 3) -> tuple[bool, tuple[int, int]]:
    """
    Check for hospital icon with retries.
    If not found on the first attempt, retry goto_world_map to dismiss 
    any overlay popup and retry.

    Returns (found, (hx, hy)).
    """
    for _check in range(attempts):
        img = emulator.screencap_bgr()
        found, (hx, hy) = _find_in_region(
            img, TPL_HOSPITAL_ICON, _HOSPITAL_SEARCH_REGION,
            threshold=_THRESH_HOSPITAL, grayscale=True,
        )
        if found:
            return True, (hx, hy)
        logger.info("heal_troops: hospital icon not found (check %d/3)", _check + 1)
        time.sleep(1)
        goto_world_map(emulator)
    return False, (0, 0)

def _check_heal_open(emulator: WosEmulator) -> tuple[bool, tuple[int, int]]:
    """
    Check if the Heal Injured popup is still open by template-matching the Heal button.
    Returns (heal_open, (hx, hy)).
    """
    img = emulator.screencap_bgr()
    found, (hx, hy) = find_template(img, TPL_HEAL_INJURED_TITLE)
    logger.info("_check_heal_open: heal popup title %s at (%d,%d)", "found" if found else "not found", hx, hy)
    return found, (hx, hy)

# ─── Public entry point ─────────────────────────────────────────────────────────
def heal_troops(emulator: WosEmulator, home_tag: str = "") -> dict:
    """
    Full heal flow:
      1. Go to world map
      2. Check for hospital icon with retries.
      3. Load alliance config for this instance, switch to heal_alliance
      4. Open hospital → double-tap Quick Select until inputs 0 → enter 85 once → heal loop
      5. Every 20 taps, check if hospital icon still present (handles Heal/Help state and detects when all healed)
      6. Return home_tag alliance if specified or original alliance if switched.

    home_tag: alliance to return to after healing. If empty, falls back to
              original_alliance. If that is also empty, does not switch back at all.
    """
    goto_world_map(emulator)

    hosp_found, (hx, hy) = _find_hospital_icon(emulator)

    if not hosp_found:
        logger.info("heal_troops: hospital icon not found — no wounded troops")
        return {"ok": True, "cycles": 0, "switched_from": None, "returned_to": None, "note": "no wounded troops"}


    from alliance import load_player_alliance_config

    cfg = load_player_alliance_config(emulator.instance_name)
    _heal_tag = cfg.get("heal_alliance", "").strip().upper()
    if not _heal_tag:
        raise WosHealError(
            f"No heal_alliance configured for instance '{emulator.instance_name}' "
            f"in config.json (under instances)"
        )
    original_tag = ensure_in_alliance(emulator, _heal_tag)
    goto_world_map(emulator)  # refresh world map after alliance switch
    time.sleep(1)

    total_taps = 0
    round_num = 1

    # Tap hospital icon to open Heal Injured popup
    emulator.tap(hx, hy)
    taps_per_round = 20
    logger.info("heal_troops: round %d — opening hospital", round_num)

    time.sleep(2)

    _double_tap_quick_select(emulator)
    _enter_batch_size(emulator, HEAL_BATCH_SIZE)

    img = emulator.screencap_bgr()
    heal_button_found, (bx, by) = find_template(img, TPL_HEAL_BTN, threshold=_THRESH_BUTTONS)

    if not heal_button_found:
        raise WosHealError("Heal button not found after entering batch size")
    heal_open = True
    while heal_open:
        
        logger.info("heal_troops: round %d — tapping Heal at (%d,%d)", round_num, bx, by)
        for _ in range(taps_per_round):
            emulator.tap(bx, by)
            time.sleep(0.5)
        total_taps += taps_per_round
        logger.info("heal_troops: round %d done, %d taps total", round_num, total_taps)
        round_num += 1

        heal_open, (hx, hy) = _check_heal_open(emulator)

    return_to = home_tag or original_tag
    if return_to and return_to.upper() != _heal_tag.upper():
        ensure_in_alliance(emulator, return_to)

    return {
        "ok": True,
        "switched_from": original_tag or None,
        "returned_to": return_to or None,
    }
