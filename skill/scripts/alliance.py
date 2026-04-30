"""
alliance.py — Idempotent alliance switching for wosctl.

Public API:
    ensure_in_alliance(emulator, tag, name_hint="") -> str
        Ensure the player is in the alliance identified by `tag`.
        Returns the original alliance tag if a switch was made, else "".
"""
from __future__ import annotations

import json
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
from navigation import find_template, goto_world_map, WosNavigationError

logger = logging.getLogger(__name__)

# ─── Templates ─────────────────────────────────────────────────────────────────
_TPL = Path(__file__).resolve().parent.parent / "templates"

TPL_ALLIANCE_NAV       = str(_TPL / "nav_alliance_button.png")
TPL_ALLIANCE_SETTINGS  = str(_TPL / "alliance_settings_cog.png")
TPL_LEAVE_ALLIANCE     = str(_TPL / "alliance_leave_button.png")
TPL_LEAVE_CONFIRM      = str(_TPL / "alliance_leave_confirm.png")
TPL_ALLIANCE_JOIN_BTN  = str(_TPL / "alliance_join_btn.png")

# ─── Constants ─────────────────────────────────────────────────────────────────
_CONFIG_FILE = Path(__file__).resolve().parent.parent / "config.json"
# Alliance name OCR region (top of alliance screen)
_ALLIANCE_NAME_REGION = (0, 90, 720, 140)

# ─── Exceptions ────────────────────────────────────────────────────────────────
class WosAllianceError(WosError):
    """Raised when alliance switching cannot complete."""


# ─── RapidOCR helper ───────────────────────────────────────────────────────────
_rapid_ocr_instance = None


def _get_rapid_ocr():
    global _rapid_ocr_instance
    if _rapid_ocr_instance is None:
        from ocr import RapidOCR
        _rapid_ocr_instance = RapidOCR()
    return _rapid_ocr_instance


# ─── Config loading ───────────────────────────────────────────────────────────
def load_player_alliance_config(instance_name: str) -> dict:
    """Return heal_alliance and battle_alliance for an instance from config.json.

    Falls back to empty strings if the instance or file is not found.
    """
    default = {"heal_alliance": "", "battle_alliance": ""}
    if not _CONFIG_FILE.exists():
        return default
    try:
        data = json.loads(_CONFIG_FILE.read_text())
        return data.get("instances", {}).get(instance_name, default)
    except (json.JSONDecodeError, OSError):
        return default


# ─── Internal helpers ──────────────────────────────────────────────────────────
def _ocr_region(img: np.ndarray, region: tuple[int, int, int, int]) -> str:
    x1, y1, x2, y2 = region
    crop = img[y1:y2, x1:x2]
    ocr = _get_rapid_ocr()
    result, _ = ocr(crop)
    return " ".join(r[1] for r in result).strip() if result else ""


def parse_alliance_tag(text: str) -> str:
    """
    Extract a 3-character alliance tag from OCR text.

    Accepts a literal opening bracket followed by exactly 3 alphanumerics.
    The closing bracket may be present or missing if OCR clipped it.
    """
    m = re.search(r'\[([A-Za-z0-9]{3})(?=\]|[^A-Za-z0-9]|$)', text)
    if m:
        return m.group(1).upper()
    return ""


def _open_alliance_screen(emulator: WosEmulator, max_attempts: int = 5) -> None:
    for attempt in range(1, max_attempts + 1):
        img = emulator.screencap_bgr()
        found, (cx, cy) = find_template(img, TPL_ALLIANCE_NAV, threshold=0.80)
        if not found:
            cx, cy = 570, 1200  # fallback from observed world map layout
            logger.warning("_open_alliance_screen: template not found, using fallback (%d,%d)", cx, cy)
        emulator.tap(cx, cy)
        time.sleep(2)
        img2 = emulator.screencap_bgr()
        # Accept either: alliance overview ('[TAG]' in name) or join list ('Join' tab visible)
        text = _ocr_region(img2, (0, 80, 720, 350))
        logger.info("_open_alliance_screen: OCR verify = %r", text)
        if "[" in text or "Join" in text or "Alliance" in text:
            logger.info("_open_alliance_screen: on alliance/join screen")
            return
        logger.warning("_open_alliance_screen: not on alliance screen (attempt %d)", attempt)
    raise WosAllianceError("Could not open alliance screen")


def _leave_current_alliance(emulator: WosEmulator) -> None:
    img = emulator.screencap_bgr()
    found, (cx, cy) = find_template(img, TPL_ALLIANCE_SETTINGS, threshold=0.80)
    if not found:
        raise WosAllianceError("Alliance settings cog not found — need template clipped")
    emulator.tap(cx, cy)
    time.sleep(1.5)

    img = emulator.screencap_bgr()
    found, (cx, cy) = find_template(img, TPL_LEAVE_ALLIANCE, threshold=0.80)
    if not found:
        raise WosAllianceError("Leave Alliance button not found — need template clipped")
    emulator.tap(cx, cy)
    time.sleep(2)

    img = emulator.screencap_bgr()
    found, (cx, cy) = find_template(img, TPL_LEAVE_CONFIRM, threshold=0.80)
    if not found:
        raise WosAllianceError("Leave Alliance confirm not found — need template clipped")
    emulator.tap(cx, cy)
    time.sleep(3)
    logger.info("_leave_current_alliance: left alliance")


def _join_alliance(emulator: WosEmulator, tag: str, name_hint: str = "") -> None:
    """
    From the Join Alliance list: OCR the visible list to find the target alliance,
    tap its row to open the Alliance Info popup, then tap the Join button.
    Searches the currently visible join list without scrolling.
    """
    img = emulator.screencap_bgr()
    result, _ = _get_rapid_ocr()(img[150:1100, 0:720])
    if result:
        for item in result:
            box, text, _ = item
            # Match on tag OR name — OCR often mangles names (e.g. AllRiseKings → AIIRiseKings)
            # but the [TAG] in brackets is usually read correctly
            text_tag = parse_alliance_tag(text)
            tag_match = text_tag.upper() == tag.upper()
            name_match = name_hint and name_hint.upper() in text.upper()
            if tag_match or name_match:
                abs_y = int(sum(p[1] for p in box) / 4) + 150
                abs_x = int(sum(p[0] for p in box) / 4)
                logger.info("_join_alliance: found %r at (%d,%d), tapping row", text, abs_x, abs_y)
                emulator.tap(abs_x, abs_y)
                time.sleep(2)
                # Alliance Info popup appears — tap the Join button
                img2 = emulator.screencap_bgr()
                found, (jx, jy) = find_template(img2, TPL_ALLIANCE_JOIN_BTN, threshold=0.85)
                if not found:
                    raise WosAllianceError(f"Join button not found in Alliance Info popup for [{tag}]")
                logger.info("_join_alliance: tapping Join at (%d,%d)", jx, jy)
                emulator.tap(jx, jy)
                time.sleep(2)
                return
    raise WosAllianceError(f"Alliance [{tag}] not found in visible list")


def get_current_alliance_tag(emulator: WosEmulator) -> str:
    """
    Navigate to the alliance screen and return the current alliance tag,
    or "" if not in any alliance.
    """
    goto_world_map(emulator)
    _open_alliance_screen(emulator)
    img = emulator.screencap_bgr()
    banner_text = _ocr_region(img, _ALLIANCE_NAME_REGION)
    tag = parse_alliance_tag(banner_text)
    logger.info("get_current_alliance_tag: banner=%r tag=%r", banner_text, tag)
    return tag


# ─── Public API ────────────────────────────────────────────────────────────────
def ensure_in_alliance(emulator: WosEmulator, tag: str, name_hint: str = "") -> str:
    """
    Ensure the player is in the alliance identified by `tag`.

    Idempotent: if already in the target alliance, does nothing.

    Returns the original alliance tag if a switch was made, or "" if already there
    (or was in no alliance).

    Handles three cases:
      1. Already in target alliance → return ""
      2. In a different alliance → leave, join target, return original tag
      3. Not in any alliance → join target, return ""
    """
    goto_world_map(emulator)
    _open_alliance_screen(emulator)
    img = emulator.screencap_bgr()

    banner_text = _ocr_region(img, _ALLIANCE_NAME_REGION)
    current_tag = parse_alliance_tag(banner_text)
    logger.info("ensure_in_alliance: banner=%r current=%r target=%r", banner_text, current_tag, tag)

    # Case 1: already in target
    if current_tag.upper() == tag.upper():
        logger.info("ensure_in_alliance: already in [%s]", tag)
        return ""

    # Case 2: in a different alliance — leave first
    if current_tag:
        original_tag = current_tag
        logger.info("ensure_in_alliance: in [%s], leaving to join [%s]", original_tag, tag)
        _leave_current_alliance(emulator)
        goto_world_map(emulator)
        _open_alliance_screen(emulator)
        _join_alliance(emulator, tag, name_hint=name_hint)
        logger.info("ensure_in_alliance: joined [%s] (was in [%s])", tag, original_tag)
        return original_tag

    # Case 3: no alliance — join list is already showing
    logger.info("ensure_in_alliance: no alliance detected, joining [%s]", tag)
    _join_alliance(emulator, tag, name_hint=name_hint)
    return ""

