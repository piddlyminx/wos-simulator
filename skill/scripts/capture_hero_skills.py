#!/usr/bin/env python3
"""Capture hero skill levels for a given emulator instance.

Navigation:
  - goto city
  - tap Heroes nav button
  - tap first hero (100, 200)
  - tap Skills button
  - for each hero: OCR name + skill levels, tap right arrow to advance
  - stop when we cycle back to the first hero

Output: updates ./data/player_hero_skills.json for the instance name.
"""

from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger(__name__)

SKILL_DIR = Path(__file__).resolve().parent.parent
TEMPLATES  = SKILL_DIR / "templates"
DATA_DIR   = SKILL_DIR / "data"

TPL_HEROES_NAV   = str(TEMPLATES / "nav_heroes_button.png")
TPL_SKILLS_BTN   = str(TEMPLATES / "hero_skills_button.png")
TPL_LOCK         = str(TEMPLATES / "hero_skill_lock.png")
TPL_NEXT_ARROW   = str(TEMPLATES / "hero_next_arrow.png")

HERO_NAMES_FILE        = DATA_DIR / "hero_names.txt"
PLAYER_HERO_SKILLS_FILE = DATA_DIR / "player_hero_skills.json"

# Geometry (all coordinates in 720×1280 space)
HERO_NAME_CROP  = (180, 10, 380, 60)   # x, y, w, h  — top-left of detail panel
SKILL_1_CROP    = (520, 210, 130, 130)
SKILL_2A_CROP   = (575, 370, 130, 130)  # position 2 (3-skill heroes: slot 2; 2-skill heroes: slot 2)
SKILL_2B_CROP   = (520, 545, 130, 130)  # fallback position 2 (2-skill hero)
SKILL_3_CROP    = (520, 545, 130, 130)  # position 3 (only if slot 2 was present)

LOCK_THRESHOLD  = 0.65
NAV_THRESHOLD   = 0.75
SKILLS_THRESHOLD = 0.70
ARROW_THRESHOLD  = 0.70


def _load_hero_names() -> list[str]:
    if HERO_NAMES_FILE.exists():
        return [l.strip() for l in HERO_NAMES_FILE.read_text().splitlines() if l.strip()]
    return []


def _match_template(img_bgr: np.ndarray, tpl_path: str, threshold: float) -> tuple[bool, tuple[int, int]]:
    """Return (found, (cx, cy))."""
    tpl = cv2.imread(tpl_path)
    if tpl is None:
        logger.warning("Template not found: %s", tpl_path)
        return False, (0, 0)
    img_g = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    tpl_g = cv2.cvtColor(tpl, cv2.COLOR_BGR2GRAY)
    th, tw = tpl_g.shape
    res = cv2.matchTemplate(img_g, tpl_g, cv2.TM_CCOEFF_NORMED)
    _, score, _, loc = cv2.minMaxLoc(res)
    if score >= threshold:
        cx = loc[0] + tw // 2
        cy = loc[1] + th // 2
        return True, (cx, cy)
    return False, (0, 0)


def _crop(img: np.ndarray, x: int, y: int, w: int, h: int) -> np.ndarray:
    return img[y:y+h, x:x+w]


def _has_lock(img: np.ndarray, x: int, y: int, w: int, h: int) -> bool:
    crop = _crop(img, x, y, w, h)
    tpl = cv2.imread(TPL_LOCK)
    if tpl is None or crop.size == 0:
        return False
    crop_g = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    tpl_g  = cv2.cvtColor(tpl, cv2.COLOR_BGR2GRAY)
    th, tw = tpl_g.shape
    if th > crop_g.shape[0] or tw > crop_g.shape[1]:
        return False
    res = cv2.matchTemplate(crop_g, tpl_g, cv2.TM_CCOEFF_NORMED)
    _, score, _, _ = cv2.minMaxLoc(res)
    return score >= LOCK_THRESHOLD


def _slot_present(img: np.ndarray, x: int, y: int, w: int, h: int) -> bool:
    """True if the slot at (x,y,w,h) is occupied — has a lock icon OR OCR returns a level."""
    if _has_lock(img, x, y, w, h):
        return True
    return _ocr_skill_level(img, x, y, w, h) is not None


def _ocr_skill_level(img: np.ndarray, x: int, y: int, w: int, h: int) -> int | None:
    """OCR a skill level box. Returns 1-5 if found, None if unreadable."""
    from ocr import RapidOCR
    ocr = RapidOCR()
    crop = _crop(img, x, y, w, h)
    if crop.size == 0:
        return None
    result = ocr(crop)
    if not result or not result[0]:
        return None
    text = " ".join(str(t) for (_, t, _) in result[0])
    m = re.search(r"[Ll][Vv]\.?\s*([1-5])", text)
    if m:
        return int(m.group(1))
    # Also accept bare digit 1-5
    m = re.search(r"\b([1-5])\b", text)
    if m:
        return int(m.group(1))
    return None


def _ocr_hero_name(img: np.ndarray, known_names: list[str], debug_dir: str | None = None, debug_idx: int = 0) -> str:
    """OCR the hero name and fuzzy-match against known_names.

    Some heroes have a stylised season suffix (e.g. "Lynn S3", "Logan S4").
    Strip any trailing S{N} token before matching so the base name is used.

    If debug_dir is set, saves the crop image and OCR results to that directory.
    """
    from ocr import RapidOCR
    import difflib
    ocr = RapidOCR()
    x, y, w, h = HERO_NAME_CROP
    crop = _crop(img, x, y, w, h)

    if debug_dir:
        debug_path = Path(debug_dir)
        debug_path.mkdir(parents=True, exist_ok=True)
        crop_file = debug_path / f"{debug_idx:03d}_name_crop.png"
        cv2.imwrite(str(crop_file), crop)

    if crop.size == 0:
        return ""

    def _try_ocr_with_pad(pad: int):
        """Add white padding around the crop and run OCR. Returns (raw_text, matched_name) or (None, None)."""
        padded = cv2.copyMakeBorder(crop, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(255, 255, 255))
        result = ocr(padded)
        if not result or not result[0]:
            return None, None
        text = " ".join(str(t) for (_, t, _) in result[0]).strip()
        if not text:
            return None, None
        # Strip trailing season suffix e.g. "S3", "S4" — with or without space before
        text_clean = re.sub(r"\s*S\d+$", "", text, flags=re.IGNORECASE).strip()
        if not text_clean:
            text_clean = text
        if known_names:
            matches = difflib.get_close_matches(text_clean, known_names, n=1, cutoff=0.6)
            if matches:
                return text, matches[0]
        # No known-name match — return raw cleaned text as fallback
        return text, text_clean

    # Try increasing padding amounts until we get a known-name match.
    # Small padding is preferred; larger padding is a fallback for tricky names
    # like Lynn and Logan whose OCR is sensitive to context margin.
    raw_text = None
    matched_name = None
    for pad in (10, 30, 50):
        raw_text, matched_name = _try_ocr_with_pad(pad)
        if matched_name and (not known_names or matched_name in known_names):
            break

    if debug_dir:
        lines = [f"raw_text: {raw_text!r}\n", f"matched_name: {matched_name!r}\n"]
        (debug_path / f"{debug_idx:03d}_ocr.txt").write_text("".join(lines))

    return matched_name or ""


def _read_skill_level(img: np.ndarray, x: int, y: int, w: int, h: int) -> int:
    """Return skill level 0-5. 0 = locked."""
    if _has_lock(img, x, y, w, h):
        return 0
    level = _ocr_skill_level(img, x, y, w, h)
    return level if level is not None else 0


def capture_hero_skills(emulator, instance_name: str, debug_dir: str | None = None) -> dict:
    """
    Navigate to Heroes screen, capture skill levels for all heroes,
    return dict {hero_name: {skill_1, skill_2, skill_3}}.
    """
    from navigation import goto_city

    known_names = _load_hero_names()
    results: dict[str, dict] = {}

    # 1. Go to city
    goto_city(emulator)
    time.sleep(1.0)

    # 2. Tap Heroes nav button
    img = emulator.screencap_bgr()
    found, (hx, hy) = _match_template(img, TPL_HEROES_NAV, NAV_THRESHOLD)
    if not found:
        raise RuntimeError("Heroes nav button not found")
    emulator.tap(hx, hy)
    time.sleep(1.5)

    # 3. Tap first hero
    emulator.tap(100, 200)
    time.sleep(1.0)

    # 4. Tap Skills button
    img = emulator.screencap_bgr()
    found, (sx, sy) = _match_template(img, TPL_SKILLS_BTN, SKILLS_THRESHOLD)
    if not found:
        raise RuntimeError("Skills button not found on hero detail page")
    emulator.tap(sx, sy)
    time.sleep(1.0)

    first_hero_name = None
    max_heroes = 60  # safety cap

    for i in range(max_heroes):
        img = emulator.screencap_bgr()

        # Save full screenshot in debug mode
        if debug_dir:
            debug_path = Path(debug_dir)
            debug_path.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(debug_path / f"{i:03d}_full.png"), img)

        # OCR hero name
        name = _ocr_hero_name(img, known_names, debug_dir=debug_dir, debug_idx=i)
        if not name:
            logger.warning("Could not read hero name on iteration %d, skipping", i)
        else:
            logger.info("Hero %d: %s", i, name)

            # Detect if we've looped back to start
            if i > 0 and name == first_hero_name:
                logger.info("Detected loop back to first hero (%s), stopping", name)
                break
            if i == 0:
                first_hero_name = name

            # Read skill_1
            s1x, s1y, s1w, s1h = SKILL_1_CROP
            skill_1 = _read_skill_level(img, s1x, s1y, s1w, s1h)

            # Determine skill_2 position and whether skill_3 exists
            s2ax, s2ay, s2aw, s2ah = SKILL_2A_CROP
            s2bx, s2by, s2bw, s2bh = SKILL_2B_CROP

            if _slot_present(img, s2ax, s2ay, s2aw, s2ah):
                # 3-skill hero: skill_2 at 2A, skill_3 at 2B
                skill_2 = _read_skill_level(img, s2ax, s2ay, s2aw, s2ah)
                skill_3 = _read_skill_level(img, s2bx, s2by, s2bw, s2bh)
            else:
                # 2-skill hero: skill_2 at 2B, no skill_3
                skill_2 = _read_skill_level(img, s2bx, s2by, s2bw, s2bh)
                skill_3 = None

            # Skip heroes where skill_1 is locked (level 0)
            if skill_1 == 0:
                logger.info("Skipping %s — skill_1 is locked", name)
            else:
                entry: dict = {"skill_1": skill_1, "skill_2": skill_2}
                if skill_3 is not None:
                    entry["skill_3"] = skill_3
                results[name] = entry
                logger.info("  %s: %s", name, entry)

        # Tap next arrow
        found, (ax, ay) = _match_template(img, TPL_NEXT_ARROW, ARROW_THRESHOLD)
        if not found:
            logger.info("Next arrow not found, stopping")
            break
        emulator.tap(ax, ay)
        time.sleep(0.8)

    return results


def save_hero_skills(instance_name: str, hero_data: dict) -> None:
    """Merge hero_data into player_hero_skills.json under instance_name."""
    existing: dict = {}
    if PLAYER_HERO_SKILLS_FILE.exists():
        try:
            existing = json.loads(PLAYER_HERO_SKILLS_FILE.read_text())
        except json.JSONDecodeError:
            logger.warning("Could not parse %s, starting fresh", PLAYER_HERO_SKILLS_FILE)

    existing[instance_name] = hero_data
    PLAYER_HERO_SKILLS_FILE.write_text(json.dumps(existing, indent=4))
    logger.info("Saved %d heroes for %s to %s", len(hero_data), instance_name, PLAYER_HERO_SKILLS_FILE)
