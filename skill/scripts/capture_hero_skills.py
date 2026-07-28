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
import os
import re
import urllib.request
import time
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger(__name__)

SKILL_DIR = Path(__file__).resolve().parent.parent
TEMPLATES  = SKILL_DIR / "templates"
DATA_DIR   = SKILL_DIR / "data"
TESSDATA_DIR = SKILL_DIR / "tessdata"
TESSDATA_ENG_URL = "https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata"
SKILL_DIGIT_ONNX_MODEL = SKILL_DIR / "models" / "hero_skill_digit.onnx"

TPL_HEROES_NAV   = str(TEMPLATES / "nav_heroes_button.png")
TPL_SKILLS_BTN   = str(TEMPLATES / "hero_skills_button.png")
TPL_LOCK         = str(TEMPLATES / "hero_skill_lock.png")
TPL_NEXT_ARROW   = str(TEMPLATES / "hero_next_arrow.png")

HERO_NAMES_FILE        = DATA_DIR / "hero_names.txt"
PLAYER_HERO_SKILLS_FILE = DATA_DIR / "player_hero_skills.json"

# Geometry (all coordinates in 720×1280 space)
HERO_NAME_CROP  = (180, 10, 380, 60)   # x, y, w, h  — top-left of detail panel
HERO_NAME_TESSERACT_CROP = (185, 8, 360, 58)
SLOT_1_CROP = (520, 210, 130, 130)
SLOT_2_CROP = (575, 370, 130, 130)
SLOT_3_CROP = (520, 545, 130, 130)
SLOT_1_LEVEL_DIGIT_CROP = (598, 308, 19, 18)
SLOT_2_LEVEL_DIGIT_CROP = (647, 466, 19, 18)
SLOT_3_LEVEL_DIGIT_CROP = (598, 637, 19, 18)
LEVEL_DIGIT_THRESHOLD = 650
HERO_NAME_THRESHOLD = 720

LOCK_THRESHOLD  = 0.65
NAV_THRESHOLD   = 0.75
SKILLS_THRESHOLD = 0.70
ARROW_THRESHOLD  = 0.70
NEXT_FRAME_TIMEOUT_SEC = 2.5
NEXT_FRAME_POLL_SEC = 0.05
_skill_digit_onnx_session = None


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


def _parse_skill_level_text(text: str) -> int | None:
    digits = re.findall(r"[1-5]", text)
    if len(digits) != 1:
        return None
    if re.search(r"[Ll]\s*[Vv]?\s*\.?\s*[1-5]", text) or re.search(r"[Vv]\s*\.?\s*[1-5]", text):
        return int(digits[0])
    if re.fullmatch(r"\s*[1-5]\s*", text):
        return int(digits[0])
    return None


def _skill_digit_mask(crop: np.ndarray) -> np.ndarray:
    return np.where(crop.astype(np.uint16).sum(axis=2) > LEVEL_DIGIT_THRESHOLD, 0, 255).astype(np.uint8)


def _skill_digit_features(crop: np.ndarray) -> np.ndarray:
    mask = _skill_digit_mask(crop)
    return (mask.astype(np.float32).reshape(1, -1) / 255.0)


def _white_text_mask(crop: np.ndarray, threshold: int) -> np.ndarray:
    return np.where(crop.astype(np.uint16).sum(axis=2) > threshold, 0, 255).astype(np.uint8)


def _onnx_session(model_path: Path):
    import onnxruntime as ort

    ort.set_default_logger_severity(3)
    options = ort.SessionOptions()
    options.log_severity_level = 3
    return ort.InferenceSession(
        str(model_path),
        sess_options=options,
        providers=["CPUExecutionProvider"],
    )


def _get_skill_digit_onnx_session():
    global _skill_digit_onnx_session
    if os.environ.get("WOS_SKILL_DIGIT_ONNX", "").lower() in {"0", "false", "no"}:
        return None
    if not SKILL_DIGIT_ONNX_MODEL.exists():
        return None
    if _skill_digit_onnx_session is None:
        _skill_digit_onnx_session = _onnx_session(SKILL_DIGIT_ONNX_MODEL)
    return _skill_digit_onnx_session


def _classify_skill_level_onnx(img: np.ndarray, x: int, y: int, w: int, h: int) -> int | None:
    digit_crop = _level_digit_crop_for_slot(x, y, w, h)
    if digit_crop is None:
        return None
    dx, dy, dw, dh = digit_crop
    crop = _crop(img, dx, dy, dw, dh)
    if crop.size == 0:
        return None
    session = _get_skill_digit_onnx_session()
    if session is None:
        return None

    input_name = session.get_inputs()[0].name
    logits = session.run(None, {input_name: _skill_digit_features(crop)})[0][0]
    pred = int(np.argmax(logits)) + 1
    # A weak margin means this crop is unlike the training set. Let OCR handle it.
    top_two = np.partition(logits, -2)[-2:]
    if float(top_two[-1] - top_two[-2]) < 1.0:
        return None
    return pred


def _ocr_skill_level_tesseract(img: np.ndarray, x: int, y: int, w: int, h: int) -> int | None:
    """Fast OCR of the single level digit for a known skill slot."""
    import pytesseract
    from PIL import Image

    digit_crop = _level_digit_crop_for_slot(x, y, w, h)
    if digit_crop is None:
        return None

    dx, dy, dw, dh = digit_crop
    crop = _crop(img, dx, dy, dw, dh)
    if crop.size == 0:
        return None

    mask = _skill_digit_mask(crop)
    tessdata_dir = _ensure_legacy_tessdata()
    try:
        raw = pytesseract.image_to_string(
            Image.fromarray(mask),
            config=f"--tessdata-dir {tessdata_dir} --psm 10 --oem 0 -c tessedit_char_whitelist=12345 ",
        ).strip()
    except pytesseract.TesseractError as exc:
        logger.warning("Tesseract OEM 0 skill OCR failed: %s", exc)
        return None
    return _parse_skill_level_text(raw)


def _ensure_legacy_tessdata() -> Path:
    traineddata = TESSDATA_DIR / "eng.traineddata"
    if traineddata.exists():
        return TESSDATA_DIR
    TESSDATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = traineddata.with_suffix(".traineddata.tmp")
    logger.info("Downloading legacy Tesseract eng.traineddata to %s", traineddata)
    urllib.request.urlretrieve(TESSDATA_ENG_URL, tmp)
    tmp.replace(traineddata)
    return TESSDATA_DIR


def _level_digit_crop_for_slot(x: int, y: int, w: int, h: int) -> tuple[int, int, int, int] | None:
    slot = (x, y, w, h)
    if slot == SLOT_1_CROP:
        return SLOT_1_LEVEL_DIGIT_CROP
    if slot == SLOT_2_CROP:
        return SLOT_2_LEVEL_DIGIT_CROP
    if slot == SLOT_3_CROP:
        return SLOT_3_LEVEL_DIGIT_CROP
    return None


def _ocr_skill_level_rapid(img: np.ndarray, x: int, y: int, w: int, h: int) -> int | None:
    """RapidOCR fallback for a skill level box. Returns 1-5 if found."""
    from ocr import RapidOCR
    ocr = RapidOCR()
    crop = _crop(img, x, y, w, h)
    if crop.size == 0:
        return None
    result = ocr(crop)
    if not result or not result[0]:
        return None
    text = " ".join(str(t) for (_, t, _) in result[0])
    return _parse_skill_level_text(text)


def _ocr_skill_level(img: np.ndarray, x: int, y: int, w: int, h: int) -> int | None:
    """OCR a skill level box. Returns 1-5 if found, None if unreadable."""
    level = _classify_skill_level_onnx(img, x, y, w, h)
    if level is not None:
        return level
    level = _ocr_skill_level_tesseract(img, x, y, w, h)
    if level is not None:
        return level
    return _ocr_skill_level_rapid(img, x, y, w, h)


def _slot_level_pill_has_text(img: np.ndarray, x: int, y: int, w: int, h: int) -> bool:
    digit_crop = _level_digit_crop_for_slot(x, y, w, h)
    if digit_crop is None:
        return False
    dx, dy, dw, dh = digit_crop
    crop = _crop(img, dx, dy, dw, dh)
    if crop.size == 0:
        return False
    light_pixels = int((crop.astype(np.uint16).sum(axis=2) > LEVEL_DIGIT_THRESHOLD).sum())
    return light_pixels >= 12


def _read_slot_presence_and_level(img: np.ndarray, x: int, y: int, w: int, h: int) -> tuple[bool, int | None]:
    """Return whether a skill slot exists and the level if OCR could read it."""
    if _has_lock(img, x, y, w, h):
        return True, 0
    if not _slot_level_pill_has_text(img, x, y, w, h):
        return False, None
    level = _classify_skill_level_onnx(img, x, y, w, h)
    if level is not None:
        return True, level
    level = _ocr_skill_level_tesseract(img, x, y, w, h)
    if level is not None:
        return True, level
    level = _ocr_skill_level_rapid(img, x, y, w, h)
    return level is not None, level


def _clean_hero_name_text(text: str) -> str:
    """Normalize OCR output before matching against the hero-name whitelist."""
    text = text.replace("|", "I").replace("—", "-").replace("_", " ")
    text = re.sub(r"\s*S\s*\d+\s*$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+S\s*$", "", text)
    text = re.sub(r"[^A-Za-z -]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _match_known_hero_name(text: str, known_names: list[str], cutoff: float = 0.58) -> str:
    import difflib

    text_clean = _clean_hero_name_text(text)
    if not text_clean:
        return ""
    if known_names:
        lower_to_name = {name.lower(): name for name in known_names}
        direct = lower_to_name.get(text_clean.lower())
        if direct:
            return direct
        matches = difflib.get_close_matches(text_clean, known_names, n=1, cutoff=cutoff)
        if matches:
            return matches[0]
    return text_clean


def _ocr_hero_name_tesseract(img: np.ndarray, known_names: list[str]) -> str:
    """Fast fixed-crop OCR for the hero title.

    The title is stable, large, and centered; running RapidOCR's full detector
    on it is overkill. Try Tesseract in single-line mode first and let the
    whitelist absorb minor badge/outline artifacts.
    """
    import difflib
    import pytesseract
    from PIL import Image

    x, y, w, h = HERO_NAME_TESSERACT_CROP
    crop = _crop(img, x, y, w, h)
    if crop.size == 0:
        return ""

    configs = (
        "--psm 7 --oem 1 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz- ",
        "--psm 8 --oem 1 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz- ",
    )
    best_text = ""
    best_score = 0.0
    best_name = ""

    def _try_image(image: np.ndarray, config: str) -> str | None:
        nonlocal best_text, best_score, best_name
        raw = pytesseract.image_to_string(Image.fromarray(image), config=config).strip()
        if not raw:
            return None
        cleaned = _clean_hero_name_text(raw)
        if not cleaned:
            return None
        if not known_names:
            return cleaned
        best_text = cleaned
        for name in known_names:
            score = difflib.SequenceMatcher(None, cleaned.lower(), name.lower()).ratio()
            if score > best_score:
                best_name = name
                best_score = score
        if best_score >= 0.78:
            return best_name
        return None

    white_text = _white_text_mask(crop, HERO_NAME_THRESHOLD)
    for config in configs:
        matched = _try_image(white_text, config)
        if matched:
            return matched

    if known_names:
        return best_name if best_score >= 0.50 else ""
    return best_text


def _ocr_hero_name(img: np.ndarray, known_names: list[str], debug_dir: str | None = None, debug_idx: int = 0) -> str:
    """OCR the hero name and fuzzy-match against known_names.

    Some heroes have a stylised season suffix (e.g. "Lynn S3", "Logan S4").
    Strip any trailing S{N} token before matching so the base name is used.

    If debug_dir is set, saves the crop image and OCR results to that directory.
    """
    fast_name = _ocr_hero_name_tesseract(img, known_names)
    if fast_name:
        return fast_name

    from ocr import RapidOCR
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
        matched = _match_known_hero_name(text, known_names, cutoff=0.6)
        return text, matched or None

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


def _read_skill_level_checked(img: np.ndarray, x: int, y: int, w: int, h: int) -> tuple[bool, int]:
    """Return (readable, level). Level 0 means locked."""
    if _has_lock(img, x, y, w, h):
        return True, 0
    level = _ocr_skill_level(img, x, y, w, h)
    if level is None:
        return False, 0
    return True, level


def _read_hero_skill_entry(img: np.ndarray) -> tuple[bool, dict | None]:
    """Return (readable, skill entry). Entry None means skill_1 is locked."""
    slot_1_ok, slot_1 = _read_skill_level_checked(img, *SLOT_1_CROP)
    if not slot_1_ok:
        return False, None
    slot_2_present, slot_2_level = _read_slot_presence_and_level(img, *SLOT_2_CROP)
    if slot_2_present and slot_2_level is None:
        return False, None
    slot_3_ok, slot_3 = _read_skill_level_checked(img, *SLOT_3_CROP)
    if not slot_3_ok:
        return False, None

    if slot_2_present:
        skill_2 = slot_2_level
        skill_3 = slot_3
    else:
        skill_2 = slot_3
        skill_3 = None

    if slot_1 == 0:
        return True, None

    entry: dict = {"skill_1": slot_1, "skill_2": skill_2}
    if skill_3 is not None:
        entry["skill_3"] = skill_3
    return True, entry


def _read_hero_frame(
    img: np.ndarray,
    known_names: list[str],
    debug_dir: str | None = None,
    debug_idx: int = 0,
) -> tuple[str, dict | None] | None:
    """Return (hero name, skill entry) when the frame has a readable name and levels."""
    name = _ocr_hero_name(img, known_names, debug_dir=debug_dir, debug_idx=debug_idx)
    if not name:
        return None
    skills_readable, entry = _read_hero_skill_entry(img)
    if not skills_readable:
        return None
    return name, entry


def _reidentify_duplicate_hero_frame(
    img: np.ndarray,
    known_names: list[str],
    seen_names: set[str],
    debug_dir: str | None = None,
    debug_idx: int = 0,
) -> tuple[str, dict | None] | None:
    """Retry a duplicate identity against only the unseen canonical names.

    Fuzzy OCR can occasionally resolve a noisy frame to an already-seen hero.
    Restricting the retry to unseen names prevents that duplicate from silently
    overwriting the earlier hero's captured skills.
    """
    unseen_names = [name for name in known_names if name not in seen_names]
    if not unseen_names:
        return None
    return _read_hero_frame(
        img,
        unseen_names,
        debug_dir=debug_dir,
        debug_idx=debug_idx,
    )


def _wait_for_readable_next_frame(
    emulator,
    known_names: list[str],
    previous_name: str,
    debug_dir: str | None = None,
    debug_idx: int = 0,
) -> tuple[np.ndarray, tuple[str, dict | None] | None]:
    deadline = time.monotonic() + NEXT_FRAME_TIMEOUT_SEC
    last_img = None
    while time.monotonic() < deadline:
        img = emulator.screencap_bgr()
        last_img = img
        name = _ocr_hero_name(img, known_names, debug_dir=debug_dir, debug_idx=debug_idx)
        if name and name != previous_name:
            skills_readable, entry = _read_hero_skill_entry(img)
            if skills_readable:
                return img, (name, entry)
        time.sleep(NEXT_FRAME_POLL_SEC)

    logger.warning("Timed out waiting for readable next hero frame after %s", previous_name)
    if last_img is None:
        last_img = emulator.screencap_bgr()
    return last_img, None


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
    seen_names: set[str] = set()
    max_heroes = 60  # safety cap
    next_frame: tuple[np.ndarray, tuple[str, dict | None] | None] | None = None

    for i in range(max_heroes):
        current_name = ""
        if next_frame is None:
            img = emulator.screencap_bgr()
            parsed = _read_hero_frame(img, known_names, debug_dir=debug_dir, debug_idx=i)
        else:
            img, parsed = next_frame
            next_frame = None

        # Save full screenshot in debug mode
        if debug_dir:
            debug_path = Path(debug_dir)
            debug_path.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(debug_path / f"{i:03d}_full.png"), img)

        if parsed is None:
            raise RuntimeError(
                f"Could not identify a complete hero frame on iteration {i}; "
                "refusing to advance to the next hero"
            )

        name, entry = parsed
        current_name = name
        logger.info("Hero %d: %s", i, name)

        # Detect if we've looped back to start.
        if i > 0 and name == first_hero_name:
            logger.info("Detected loop back to first hero (%s), stopping", name)
            break
        if i == 0:
            first_hero_name = name

        # Re-read a duplicate non-loop identity with seen names excluded.
        if name in seen_names:
            retry = _reidentify_duplicate_hero_frame(
                img,
                known_names,
                seen_names,
                debug_dir=debug_dir,
                debug_idx=i,
            )
            if retry is None or retry[0] in seen_names:
                raise RuntimeError(
                    f"Hero frame {i} was identified as duplicate {name!r} and "
                    "could not be uniquely reidentified; refusing to advance"
                )
            name, entry = retry
            current_name = name
            logger.info("Reidentified duplicate %s as %s", parsed[0], name)

        seen_names.add(name)

        # Skip heroes where skill_1 is locked (level 0)
        if entry is None:
            logger.info("Skipping %s — skill_1 is locked", name)
        else:
            results[name] = entry
            logger.info("  %s: %s", name, entry)
            if debug_dir:
                (debug_path / f"{i:03d}_skills.json").write_text(
                    json.dumps({"hero": name, "skills": entry}, indent=2)
                )

        # Tap next arrow
        found, (ax, ay) = _match_template(img, TPL_NEXT_ARROW, ARROW_THRESHOLD)
        if not found:
            logger.info("Next arrow not found, stopping")
            break
        emulator.tap(ax, ay)
        if current_name:
            next_frame = _wait_for_readable_next_frame(
                emulator,
                known_names,
                previous_name=current_name,
                debug_dir=debug_dir,
                debug_idx=i + 1,
            )

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
