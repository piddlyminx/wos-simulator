"""Shared parser for WOS report Stat Bonuses and troop rows.

This combines the simulator repo's OCR-box based stat parser with the skill
repo's troop-avatar template matching. It returns counts, type, tier, and
fire-crystal level as separate fields while preserving the legacy
``troop_power`` shape used by existing callers.
"""
from __future__ import annotations

import base64
import dataclasses
import difflib
import json
import logging
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Iterable

import cv2
import numpy as np

logger = logging.getLogger(__name__)

SKILL_DIR = Path(__file__).resolve().parent.parent

STAT_FIELDS = [
    "infantry_attack",
    "infantry_defense",
    "infantry_lethality",
    "infantry_health",
    "lancer_attack",
    "lancer_defense",
    "lancer_lethality",
    "lancer_health",
    "marksman_attack",
    "marksman_defense",
    "marksman_lethality",
    "marksman_health",
]
TROOP_TYPES = ("infantry", "lancer", "marksman")
STAT_NAMES = ("attack", "defense", "lethality", "health")

HEADER_MATCH_TEXT = "statbonuses"
COMMON_LABEL_TRANSLATIONS = str.maketrans(
    {"0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "6": "g", "7": "t", "8": "b", "|": "l", "$": "s"}
)
EXPECTED_MATCH_TEXT = {field: re.sub(r"[^a-z]", "", field) for field in STAT_FIELDS}

TROOP_SLOT_CENTERS = (0.09, 0.235, 0.38, 0.62, 0.765, 0.91)
TROOP_SLOT_HALF_WIDTH = 0.07
MIN_TROOP_AVATAR_SCORE = 0.55
MIN_FC_BADGE_TEMPLATE_SCORE = 0.80
FC_BADGE_TEMPLATE_SCALES = tuple(scale / 100.0 for scale in range(75, 151, 5))

_rapid_ocr: Any = None
_fast_rapid_ocr: Any = None
_fc_badge_templates: list[tuple[int, str, np.ndarray, np.ndarray]] | None = None


@dataclasses.dataclass(frozen=True)
class OCRItem:
    text: str
    x1: int
    y1: int
    x2: int
    y2: int
    confidence: float = 0.0

    @property
    def cx(self) -> float:
        return (self.x1 + self.x2) / 2.0

    @property
    def cy(self) -> float:
        return (self.y1 + self.y2) / 2.0

    @property
    def width(self) -> int:
        return self.x2 - self.x1

    @property
    def height(self) -> int:
        return self.y2 - self.y1


def _get_rapid() -> Any:
    global _rapid_ocr
    if _rapid_ocr is None:
        from ocr import RapidOCR

        _rapid_ocr = RapidOCR(use_angle_cls=False)
    return _rapid_ocr


def _get_fast_rapid() -> Any:
    """RapidOCR tuned for fixed-size report screenshots.

    The default server detector is accurate but slow for dashboard uploads.
    Battle report crops are small and axis-aligned, so the mobile detector with
    a bounded side length keeps fixture accuracy while avoiding the costly 2x
    full-image enhancement pass in the common path.
    """
    global _fast_rapid_ocr
    if _fast_rapid_ocr is None:
        from ocr import RapidOCR
        from rapidocr import ModelType

        _fast_rapid_ocr = RapidOCR(
            use_angle_cls=False,
            params={"Det.model_type": ModelType.MOBILE, "Det.limit_side_len": 224},
        )
    return _fast_rapid_ocr


def _normalize_label_text(text: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "", text.lower())
    return cleaned.translate(COMMON_LABEL_TRANSLATIONS)


def _parse_percentage(text: str) -> float | None:
    if re.search(r"-\s*\d", text):
        return None
    cleaned = re.sub(r"[^0-9.+]", "", text)
    if not cleaned or cleaned in {"+", "."}:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _parse_integer(text: str) -> int | None:
    cleaned = re.sub(r"[^0-9]", "", text)
    if not cleaned:
        return None
    try:
        return int(cleaned)
    except ValueError:
        return None


def _parse_integer_tokens(text: str) -> list[int]:
    """Parse multiple integer-looking tokens without merging whitespace."""
    values: list[int] = []
    for match in re.finditer(r"\d[\d,]*", text):
        value = _parse_integer(match.group(0))
        if value is not None:
            values.append(value)
    return values


def _parse_tier(text: str) -> int | None:
    """Parse OCR forms like ``Lv.11.0`` or ``Lv.10`` as the troop tier.

    The dotted suffix is part of the in-game troop level display and is not a
    fire-crystal level. FC level is determined only from the badge.
    """
    cleaned = text.strip().lower()
    cleaned = cleaned.replace("l v", "lv").replace("iv", "lv")
    if "," in cleaned:
        return None
    if "lv" not in cleaned and "." not in cleaned and ":" not in cleaned:
        return None
    match = re.search(r"(?:lv\.?\s*)?(\d{1,2})(?:\s*[\.:]\s*\d{1,2})?", cleaned)
    if match:
        tier = int(match.group(1))
        if 1 <= tier <= 12:
            return tier
    return None


def _preprocess_image(img_bgr: np.ndarray, *, scale: float = 1.0, sharpen: bool = False, clahe: bool = False) -> np.ndarray:
    processed = img_bgr.copy()
    if scale != 1.0:
        processed = cv2.resize(processed, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    if clahe:
        lab = cv2.cvtColor(processed, cv2.COLOR_BGR2LAB)
        l_channel, a_channel, b_channel = cv2.split(lab)
        clahe_filter = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        processed = cv2.cvtColor(cv2.merge((clahe_filter.apply(l_channel), a_channel, b_channel)), cv2.COLOR_LAB2BGR)
    if sharpen:
        kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]], dtype=np.float32)
        processed = cv2.filter2D(processed, -1, kernel)
    return processed


def _crop_report_panel_for_ocr(img_bgr: np.ndarray) -> np.ndarray:
    """Trim non-report controls below the stat panel before OCR.

    Dashboard uploads are report-panel screenshots with blue action buttons
    below the parseable content. Removing those controls keeps coordinates
    stable while reducing OCR detector work. If the tan panel-bottom band cannot
    be found, return the original image and let the normal fallback path handle
    the crop.
    """
    if img_bgr.size == 0:
        return img_bgr
    image_height = img_bgr.shape[0]
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    tan_mask = cv2.inRange(hsv, (5, 20, 100), (30, 120, 245))
    row_density = tan_mask.mean(axis=1) / 255.0
    rows = np.where(row_density > 0.55)[0]
    groups: list[list[int]] = []
    for row in rows:
        row_index = int(row)
        if not groups or row_index > groups[-1][-1] + 1:
            groups.append([row_index])
        else:
            groups[-1].append(row_index)

    bottom_candidates = [group for group in groups if len(group) > 2 and group[0] > image_height * 0.45]
    if not bottom_candidates:
        return img_bgr
    crop_bottom = min(image_height, bottom_candidates[0][-1] + 8)
    if crop_bottom >= image_height - 8:
        return img_bgr
    return img_bgr[:crop_bottom]


def _ocr_pass(
    img_bgr: np.ndarray,
    *,
    scale: float = 1.0,
    sharpen: bool = False,
    clahe: bool = False,
    fast: bool = False,
) -> list[OCRItem]:
    processed = _preprocess_image(img_bgr, scale=scale, sharpen=sharpen, clahe=clahe)
    result = (_get_fast_rapid() if fast else _get_rapid())(processed)
    if not result or not result[0]:
        return []
    items: list[OCRItem] = []
    for box, text, confidence in result[0]:
        xs = [point[0] for point in box]
        ys = [point[1] for point in box]
        items.append(
            OCRItem(
                text=str(text).strip(),
                x1=int(min(xs) / scale),
                y1=int(min(ys) / scale),
                x2=int(max(xs) / scale),
                y2=int(max(ys) / scale),
                confidence=float(confidence),
            )
        )
    return items


def _merge_ocr_items(*groups: Iterable[OCRItem]) -> list[OCRItem]:
    merged: dict[tuple[str, int, int], OCRItem] = {}
    for group in groups:
        for item in group:
            if not item.text:
                continue
            key = (_normalize_label_text(item.text) or item.text.lower(), round(item.cx / 8), round(item.cy / 8))
            previous = merged.get(key)
            if previous is None or item.confidence >= previous.confidence:
                merged[key] = item
    return list(merged.values())


def _match_header(items: list[OCRItem]) -> OCRItem | None:
    best_item: OCRItem | None = None
    best_score = 0.0
    for item in items:
        normalized = _normalize_label_text(item.text)
        if not normalized:
            continue
        score = difflib.SequenceMatcher(None, normalized, HEADER_MATCH_TEXT).ratio()
        if HEADER_MATCH_TEXT in normalized:
            score += 0.25
        if score > best_score:
            best_item = item
            best_score = score
    return best_item if best_score >= 0.72 else None


def _match_stat_label(text: str) -> tuple[str, float] | None:
    normalized = _normalize_label_text(text)
    if not normalized:
        return None
    best_field: str | None = None
    best_score = 0.0
    for field, expected in EXPECTED_MATCH_TEXT.items():
        score = difflib.SequenceMatcher(None, normalized, expected).ratio()
        if expected in normalized or normalized in expected:
            score += 0.15
        if score > best_score:
            best_field = field
            best_score = score
    if best_field is None or best_score < 0.72:
        return None
    return best_field, min(best_score, 1.0)


def _split_mixed_label_value(item: OCRItem) -> tuple[OCRItem | None, OCRItem | None]:
    match = re.search(r"[+\-]?\d[\d,]*(?:\.\d+)?\s*%", item.text)
    if match is None:
        return None, None
    char_width = item.width / max(1, len(item.text))
    value_x1 = min(item.x2 - 1, item.x1 + int(round(match.start() * char_width)))
    value_x2 = min(item.x2, item.x1 + int(round(match.end() * char_width)))
    label_before = item.text[: match.start()].strip()
    label_after = item.text[match.end() :].strip()
    if any(ch.isalpha() for ch in label_before):
        label_text = label_before
        label_x1 = item.x1
        label_x2 = max(item.x1 + 1, value_x1 - 4)
    elif any(ch.isalpha() for ch in label_after):
        label_text = label_after
        label_x1 = min(item.x2 - 1, value_x2 + 4)
        label_x2 = item.x2
    else:
        return None, None
    label = OCRItem(
        text=label_text,
        x1=label_x1,
        y1=item.y1,
        x2=label_x2,
        y2=item.y2,
        confidence=item.confidence,
    )
    value = OCRItem(
        text=match.group(0).strip(),
        x1=value_x1,
        y1=item.y1,
        x2=item.x2,
        y2=item.y2,
        confidence=item.confidence,
    )
    return label, value


def _strip_label_noise(item: OCRItem) -> OCRItem:
    text = item.text.strip()
    cleaned = re.sub(r"\s*[+\-]+$", "", text).strip()
    if cleaned == text:
        return item
    removed = len(text) - len(cleaned)
    char_width = item.width / max(1, len(text))
    return OCRItem(
        text=cleaned,
        x1=item.x1,
        y1=item.y1,
        x2=max(item.x1 + 1, item.x2 - int(round(removed * char_width))),
        y2=item.y2,
        confidence=item.confidence,
    )


def _candidate_label_items(items: Iterable[OCRItem]) -> list[OCRItem]:
    """Return original OCR labels plus same-row word combinations.

    RapidOCR often splits labels such as "Infantry Defense" into adjacent
    "Infantry" and "Defense" boxes. Matching those fragments independently can
    map "Defense" to the wrong troop type, so build candidate phrase boxes
    before selecting the best stat label.
    """
    label_words: list[OCRItem] = []
    for item in items:
        if not any(ch.isalpha() for ch in item.text):
            continue
        label_part, _value_part = _split_mixed_label_value(item)
        if label_part is not None:
            label_words.append(_strip_label_noise(label_part))
            continue
        if "%" in item.text or _parse_percentage(item.text) is not None or _parse_integer(item.text) is not None:
            continue
        label_words.append(_strip_label_noise(item))
    candidates = list(label_words)
    for index, item in enumerate(label_words):
        row = [
            other
            for other in label_words
            if other is not item and abs(other.cy - item.cy) <= max(18, (item.height + other.height) * 0.55)
        ]
        row.append(item)
        row = sorted(row, key=lambda candidate: candidate.x1)
        try:
            start = row.index(item)
        except ValueError:
            continue
        for length in (2, 3):
            phrase_items = row[start : start + length]
            if len(phrase_items) != length:
                continue
            gaps = [phrase_items[pos + 1].x1 - phrase_items[pos].x2 for pos in range(len(phrase_items) - 1)]
            if any(gap > 40 for gap in gaps):
                continue
            text = " ".join(part.text for part in phrase_items)
            candidates.append(
                OCRItem(
                    text=text,
                    x1=min(part.x1 for part in phrase_items),
                    y1=min(part.y1 for part in phrase_items),
                    x2=max(part.x2 for part in phrase_items),
                    y2=max(part.y2 for part in phrase_items),
                    confidence=min(part.confidence for part in phrase_items),
                )
            )
    return candidates


def _candidate_percentage_items(items: Iterable[OCRItem]) -> list[OCRItem]:
    candidates: list[OCRItem] = []
    for item in items:
        if _parse_percentage(item.text) is not None and "%" in item.text:
            candidates.append(item)
        _label_part, value_part = _split_mixed_label_value(item)
        if value_part is not None:
            candidates.append(value_part)
    return candidates


def _select_best_label_boxes(items: list[OCRItem], header: OCRItem) -> dict[str, OCRItem]:
    matched: dict[str, tuple[float, OCRItem]] = {}
    for item in _candidate_label_items(items):
        if item.cy <= header.cy + 10 or item.y1 >= header.y2 + 850:
            continue
        label_match = _match_stat_label(item.text)
        if label_match is None:
            continue
        field, score = label_match
        quality = score * 10.0 + item.confidence
        current = matched.get(field)
        if current is None or quality > current[0]:
            matched[field] = (quality, item)
    return {field: item for field, (_quality, item) in matched.items()}


def _select_best_label_boxes_anywhere(items: list[OCRItem]) -> dict[str, OCRItem]:
    matched: dict[str, tuple[float, OCRItem]] = {}
    for item in _candidate_label_items(items):
        label_match = _match_stat_label(item.text)
        if label_match is None:
            continue
        field, score = label_match
        quality = score * 10.0 + item.confidence
        current = matched.get(field)
        if current is None or quality > current[0]:
            matched[field] = (quality, item)
    return {field: item for field, (_quality, item) in matched.items()}


def _pick_numeric_for_row(numeric_items: list[OCRItem], label_item: OCRItem, *, side: str, image_width: int) -> OCRItem | None:
    row_tolerance = max(18, int(label_item.height * 1.4))
    candidates: list[tuple[float, OCRItem]] = []
    for item in numeric_items:
        if abs(item.cy - label_item.cy) > row_tolerance:
            continue
        if side == "left":
            if item.cx >= label_item.cx:
                continue
            gap = max(0, label_item.x1 - item.x2)
            edge_penalty = abs(item.cx - image_width * 0.22)
        else:
            if item.cx <= label_item.cx:
                continue
            gap = max(0, item.x1 - label_item.x2)
            edge_penalty = abs(item.cx - image_width * 0.78)
        score = abs(item.cy - label_item.cy) * 4.0 + gap * 0.02 + edge_penalty * 0.01 - item.confidence
        candidates.append((score, item))
    if not candidates:
        return None
    return sorted(candidates, key=lambda pair: pair[0])[0][1]


def _extract_troop_count_slot_items(
    items: list[OCRItem], header: OCRItem, image_width: int, image_height: int
) -> dict[int, tuple[int, OCRItem]]:
    assigned: dict[int, tuple[float, OCRItem, int]] = {}
    scale = image_width / 720.0
    # Troop counts sit in a narrow row just above the Stat Bonuses header. A
    # wider scan can admit unrelated numeric UI fragments above the avatar row.
    count_y1 = max(0, header.y1 - int(round(68 * scale)))
    count_y2 = min(image_height, header.y1 - int(round(37 * scale)))
    for item in items:
        if item.cy < count_y1 or item.cy > count_y2:
            continue
        if any(ch.isalpha() for ch in item.text) or "." in item.text or "%" in item.text:
            continue
        values = [value for value in _parse_integer_tokens(item.text) if value > 0]
        if not values:
            continue
        for index, value in enumerate(values):
            if len(values) == 1:
                cx = item.cx
            else:
                token_width = item.width / len(values)
                cx = item.x1 + token_width * (index + 0.5)
            slot = min(range(6), key=lambda idx: abs(cx - image_width * TROOP_SLOT_CENTERS[idx]))
            distance = abs(cx - image_width * TROOP_SLOT_CENTERS[slot])
            if distance > image_width * TROOP_SLOT_HALF_WIDTH * 1.8:
                continue
            score = distance - item.confidence
            current = assigned.get(slot)
            if current is None or score < current[0]:
                assigned[slot] = (score, item, value)
    return {slot: (int(value), item) for slot, (_score, item, value) in assigned.items()}


def _extract_troop_count_slots(items: list[OCRItem], header: OCRItem, image_width: int, image_height: int) -> dict[int, int]:
    return {
        slot: value
        for slot, (value, _item) in _extract_troop_count_slot_items(items, header, image_width, image_height).items()
    }


def _counts_by_side_from_slots(slot_counts: dict[int, int]) -> dict[str, dict[str, int]]:
    result = {"left": {}, "right": {}}
    for slot, value in slot_counts.items():
        side = "left" if slot < 3 else "right"
        troop_type = TROOP_TYPES[slot if side == "left" else slot - 3]
        result[side][troop_type] = int(value)
    return result


def _extract_troop_counts(items: list[OCRItem], header: OCRItem, image_width: int, image_height: int) -> dict[str, dict[str, int]]:
    return _counts_by_side_from_slots(_extract_troop_count_slots(items, header, image_width, image_height))


def _extract_level_slots(items: list[OCRItem], header: OCRItem, image_width: int, image_height: int) -> dict[str, dict[str, dict[str, int | None]]]:
    candidates: list[OCRItem] = []
    for item in items:
        if item.cy >= header.y1 - 4:
            continue
        if item.y1 < max(0, header.y1 - int(image_height * 0.22)):
            continue
        tier = _parse_tier(item.text)
        if tier is not None:
            candidates.append(item)

    result = {
        "left": {troop_type: {"tier": None, "fire_crystal_level": None} for troop_type in TROOP_TYPES},
        "right": {troop_type: {"tier": None, "fire_crystal_level": None} for troop_type in TROOP_TYPES},
    }
    for item in sorted(candidates, key=lambda i: i.confidence, reverse=True):
        slot = min(range(6), key=lambda idx: abs(item.cx - image_width * TROOP_SLOT_CENTERS[idx]))
        if abs(item.cx - image_width * TROOP_SLOT_CENTERS[slot]) > image_width * TROOP_SLOT_HALF_WIDTH * 1.5:
            continue
        side = "left" if slot < 3 else "right"
        troop_type = TROOP_TYPES[slot if side == "left" else slot - 3]
        if result[side][troop_type]["tier"] is None:
            tier = _parse_tier(item.text)
            result[side][troop_type] = {"tier": tier, "fire_crystal_level": None}
    return result


def _tesseract_text(crop_bgr: np.ndarray, config: list[str] | None = None) -> str:
    if crop_bgr.size == 0 or not shutil.which("tesseract"):
        return ""
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=True) as handle:
        cv2.imwrite(handle.name, gray)
        completed = subprocess.run(
            ["tesseract", handle.name, "stdout", *(config or ["--psm", "7"])],
            capture_output=True,
            text=True,
            check=False,
        )
    return completed.stdout.strip()


def _ocr_crop_texts(crop_bgr: np.ndarray) -> list[str]:
    candidates: list[str] = []
    for kwargs in (
        {"scale": 1.0, "sharpen": False, "clahe": False},
        {"scale": 2.0, "sharpen": True, "clahe": True},
    ):
        for item in _ocr_pass(crop_bgr, **kwargs):
            if item.text:
                candidates.append(item.text)
    tess = _tesseract_text(crop_bgr)
    if tess:
        candidates.append(tess)
    return candidates


def _ocr_count_crop(crop_bgr: np.ndarray) -> int | None:
    texts: list[str] = []
    for item in _ocr_pass(crop_bgr, scale=2.0, sharpen=True, clahe=True):
        if item.text:
            texts.append(item.text)
    tess = _tesseract_text(crop_bgr, ["--psm", "7", "-c", "tessedit_char_whitelist=0123456789,"])
    if tess:
        texts.append(tess)
    values = [_parse_integer(text) for text in texts]
    values = [value for value in values if value is not None and value >= 10]
    if not values:
        return None
    return max(values, key=lambda value: len(str(value)))


def _repair_troop_counts_from_slots(result: dict[str, Any], img_bgr: np.ndarray) -> None:
    image_height, image_width = img_bgr.shape[:2]
    header = OCRItem(**result["meta"]["header_box"])
    scale = image_width / 720.0
    count_y1 = max(0, header.y1 - int(round(68 * scale)))
    count_y2 = min(image_height, header.y1 - int(round(37 * scale)))
    for slot_index in range(6):
        side = "left" if slot_index < 3 else "right"
        troop_type = TROOP_TYPES[slot_index if side == "left" else slot_index - 3]
        current = result[side]["troop_counts"].get(troop_type)
        if current is not None and 10 <= current <= 5_000_000:
            continue
        x1, x2 = _slot_x_bounds(image_width, slot_index)
        value = _ocr_count_crop(img_bgr[count_y1:count_y2, x1:x2])
        if value is None:
            continue
        if current is None and value < 1000:
            continue
        if current is None or current < 10 or current > 5_000_000:
            result[side]["troop_counts"][troop_type] = value


def _slot_x_bounds(image_width: int, slot_index: int) -> tuple[int, int]:
    centers = [image_width * center for center in TROOP_SLOT_CENTERS]
    if slot_index == 0:
        x1 = 0
    else:
        x1 = int((centers[slot_index - 1] + centers[slot_index]) / 2) + 5
    if slot_index == 5:
        x2 = image_width
    else:
        x2 = int((centers[slot_index] + centers[slot_index + 1]) / 2) - 5
    if slot_index in (0, 5):
        x1 = max(0, x1 - 15)
        x2 = min(image_width, x2 + 20)
    return x1, x2


def _repair_tiers_from_slots(result: dict[str, Any], img_bgr: np.ndarray) -> None:
    image_height, image_width = img_bgr.shape[:2]
    header = OCRItem(**result["meta"]["header_box"])
    scale = image_width / 720.0
    level_y1 = max(0, header.y1 - int(round(100 * scale)))
    level_y2 = min(image_height, header.y1 - int(round(62 * scale)))
    for slot_index in range(6):
        side = "left" if slot_index < 3 else "right"
        troop_type = TROOP_TYPES[slot_index if side == "left" else slot_index - 3]
        if result[side]["levels"].get(troop_type, {}).get("tier") is not None:
            continue
        x1, x2 = _slot_x_bounds(image_width, slot_index)
        for text in _ocr_crop_texts(img_bgr[level_y1:level_y2, x1:x2]):
            tier = _parse_tier(text)
            if tier is not None:
                result[side]["levels"][troop_type] = {"tier": tier, "fire_crystal_level": None}
                break


def _fill_missing_tiers_from_side_mode(result: dict[str, Any]) -> None:
    for side in ("left", "right"):
        tiers = [
            info.get("tier")
            for info in result[side]["levels"].values()
            if info.get("tier") is not None
        ]
        if not tiers:
            continue
        tier = max(set(tiers), key=tiers.count)
        for troop_type, count in result[side]["troop_counts"].items():
            if count > 0 and result[side]["levels"].get(troop_type, {}).get("tier") is None:
                result[side]["levels"][troop_type] = {"tier": tier, "fire_crystal_level": None}


def _repair_missing_values(result: dict[str, Any], img_bgr: np.ndarray) -> dict[str, Any]:
    image_height, image_width = img_bgr.shape[:2]
    header = OCRItem(**result["meta"]["header_box"])
    label_boxes = {field: OCRItem(**box) for field, box in result["meta"]["label_boxes"].items()}

    for field, label_box in label_boxes.items():
        y1 = max(0, label_box.y1 - 8)
        y2 = min(image_height, label_box.y2 + 8)
        for side in ("left", "right"):
            if field in result[side]["stat_bonuses"]:
                continue
            if side == "left":
                x1 = max(0, int(image_width * 0.08))
                x2 = max(x1 + 10, label_box.x1 - 8)
            else:
                x1 = min(image_width - 10, label_box.x2 + 8)
                x2 = min(image_width, int(image_width * 0.92))
            crop = img_bgr[y1:y2, x1:x2]
            for text in _ocr_crop_texts(crop):
                value = _parse_percentage(text)
                if value is not None:
                    result[side]["stat_bonuses"][field] = value
                    break

    if result.get("meta", {}).get("troop_slots_present") is not False:
        count_y1 = max(0, header.y1 - int(image_height * 0.11))
        count_y2 = max(count_y1 + 10, header.y1 - int(image_height * 0.015))
        level_y1 = max(0, header.y1 - int(image_height * 0.19))
        level_y2 = max(level_y1 + 10, count_y1)
        for slot_index in range(6):
            side = "left" if slot_index < 3 else "right"
            troop_type = TROOP_TYPES[slot_index if side == "left" else slot_index - 3]
            cx = int(image_width * TROOP_SLOT_CENTERS[slot_index])
            half_width = int(image_width * TROOP_SLOT_HALF_WIDTH)
            x1 = max(0, cx - half_width)
            x2 = min(image_width, cx + half_width)
            if troop_type not in result[side]["troop_counts"]:
                crop = img_bgr[count_y1:count_y2, x1:x2]
                for text in _ocr_crop_texts(crop):
                    value = _parse_integer(text)
                    if value is not None and value > 0:
                        result[side]["troop_counts"][troop_type] = value
                        break
            level = result[side]["levels"].setdefault(
                troop_type,
                {"tier": None, "fire_crystal_level": None},
            )
            if level["tier"] is None:
                crop = img_bgr[level_y1:level_y2, x1:x2]
                for text in _ocr_crop_texts(crop):
                    tier = _parse_tier(text)
                    if tier is not None:
                        result[side]["levels"][troop_type] = {"tier": tier, "fire_crystal_level": None}
                        break

    _refresh_missing_fields(result)
    return result


def _refresh_missing_fields(result: dict[str, Any]) -> None:
    missing: list[str] = []
    if result.get("meta", {}).get("troop_slots_present") is False:
        for side in ("left", "right"):
            for troop_type in TROOP_TYPES:
                missing.append(f"{side}_{troop_type}_count")
                missing.append(f"{side}_{troop_type}_tier")
    for side in ("left", "right"):
        for troop_type in result[side]["troop_counts"]:
            if result[side]["levels"].get(troop_type, {}).get("tier") is None:
                missing.append(f"{side}_{troop_type}_tier")
    for field in STAT_FIELDS:
        if field not in result["left"]["stat_bonuses"]:
            missing.append(f"left_{field}")
        if field not in result["right"]["stat_bonuses"]:
            missing.append(f"right_{field}")
    result["meta"]["missing_fields"] = missing


def _needs_ocr_repair(result: dict[str, Any]) -> bool:
    if result.get("meta", {}).get("troop_slots_present") is False:
        return any(
            field.removeprefix("left_").removeprefix("right_") in STAT_FIELDS
            for field in result["meta"].get("missing_fields", [])
        )
    return any(
        not field.endswith("_fire_crystal_level")
        for field in result["meta"].get("missing_fields", [])
    )


def _compute_final_missing_fields(result: dict[str, Any]) -> list[str]:
    missing: set[str] = set()
    if result.get("meta", {}).get("troop_slots_present") is False:
        for side in ("left", "right"):
            for troop_type in TROOP_TYPES:
                missing.add(f"{side}_{troop_type}_count")
                missing.add(f"{side}_{troop_type}_tier")
    for field in STAT_FIELDS:
        if field not in result["left"]["stat_bonuses"]:
            missing.add(f"left_{field}")
        if field not in result["right"]["stat_bonuses"]:
            missing.add(f"right_{field}")
    for side in ("left", "right"):
        for troop in result[side].get("troops", []):
            troop_type = troop.get("type")
            if troop.get("tier") is None:
                missing.add(f"{side}_{troop_type}_tier")
            if troop.get("fire_crystal_level") is None:
                missing.add(f"{side}_{troop_type}_fire_crystal_level")
    return sorted(missing)


def _finalize_troops_and_missing(result: dict[str, Any], img_bgr: np.ndarray) -> None:
    _fill_missing_tiers_from_side_mode(result)
    troop_details = _extract_typed_troops_from_slots(result, img_bgr)
    result["left"]["troops"] = troop_details["left"]
    result["right"]["troops"] = troop_details["right"]
    result["meta"]["missing_fields"] = _compute_final_missing_fields(result)


def extract_values_from_ocr_items(items: Iterable[OCRItem | dict[str, Any]], *, image_width: int, image_height: int) -> dict[str, Any]:
    ocr_items = [_coerce_item(item) for item in items if str(item["text"] if isinstance(item, dict) else item.text).strip()]
    header = _match_header(ocr_items)
    has_troop_slots = header is not None
    if header is None:
        label_boxes = _select_best_label_boxes_anywhere(ocr_items)
        if len(label_boxes) < 8:
            raise ValueError("Could not find a 'Stat Bonuses' header in the OCR output")
        top = min(item.y1 for item in label_boxes.values())
        bottom = max(item.y2 for item in label_boxes.values())
        header = OCRItem(
            text="stats-panel",
            x1=0,
            y1=max(0, top - 40),
            x2=image_width,
            y2=max(0, top - 1),
            confidence=1.0,
        )
    else:
        label_boxes = _select_best_label_boxes(ocr_items, header)

    percentage_items = [
        item
        for item in _candidate_percentage_items(ocr_items)
        if (not has_troop_slots or item.cy > header.cy) and _parse_percentage(item.text) is not None and "%" in item.text
    ]

    left_stats: dict[str, float] = {}
    right_stats: dict[str, float] = {}
    for field, label_box in label_boxes.items():
        left_item = _pick_numeric_for_row(percentage_items, label_box, side="left", image_width=image_width)
        right_item = _pick_numeric_for_row(percentage_items, label_box, side="right", image_width=image_width)
        if left_item is not None:
            value = _parse_percentage(left_item.text)
            if value is not None:
                left_stats[field] = value
        if right_item is not None:
            value = _parse_percentage(right_item.text)
            if value is not None:
                right_stats[field] = value

    if has_troop_slots:
        troop_count_slot_items = _extract_troop_count_slot_items(ocr_items, header, image_width, image_height)
        troop_count_slots = {slot: value for slot, (value, _item) in troop_count_slot_items.items()}
        troop_counts = _counts_by_side_from_slots(troop_count_slots)
        levels = _extract_level_slots(ocr_items, header, image_width, image_height)
    else:
        troop_count_slot_items = {}
        troop_count_slots = {}
        troop_counts = {"left": {}, "right": {}}
        levels = {"left": {}, "right": {}}
    result = {
        "left": {"troop_counts": troop_counts["left"], "levels": levels["left"], "stat_bonuses": left_stats},
        "right": {"troop_counts": troop_counts["right"], "levels": levels["right"], "stat_bonuses": right_stats},
        "meta": {
            "header_box": dataclasses.asdict(header),
            "label_boxes": {field: dataclasses.asdict(item) for field, item in label_boxes.items()},
            "ocr_item_count": len(ocr_items),
            "slot_count_boxes": {
                str(slot): dataclasses.asdict(item) for slot, (_value, item) in sorted(troop_count_slot_items.items())
            },
            "slot_counts": {str(slot): count for slot, count in sorted(troop_count_slots.items())},
            "troop_slots_present": has_troop_slots,
            "missing_fields": [],
        },
    }
    if not has_troop_slots:
        result["meta"]["stats_panel_bounds"] = {"top": top, "bottom": bottom}
    _refresh_missing_fields(result)
    return result


def _coerce_item(raw: OCRItem | dict[str, Any]) -> OCRItem:
    if isinstance(raw, OCRItem):
        return raw
    return OCRItem(
        text=str(raw["text"]),
        x1=int(raw["x1"]),
        y1=int(raw["y1"]),
        x2=int(raw["x2"]),
        y2=int(raw["y2"]),
        confidence=float(raw.get("confidence", 0.0)),
    )


def _best_avatar_match(avatar_crop: np.ndarray, candidates: tuple[str, ...]) -> tuple[str, float, str]:
    best = ("unknown", -1.0, "none")
    if avatar_crop.size == 0:
        return best
    for troop in candidates:
        tpl_dir = SKILL_DIR / "templates" / "troop_avatars_trimmed2" / troop
        for p in tpl_dir.glob("*.png"):
            tpl = cv2.imread(str(p))
            if tpl is None:
                continue
            th, tw = tpl.shape[:2]
            ih, iw = avatar_crop.shape[:2]
            if th >= ih or tw >= iw:
                continue
            res = cv2.matchTemplate(avatar_crop, tpl, cv2.TM_CCOEFF_NORMED)
            _, score, _, _ = cv2.minMaxLoc(res)
            if score > best[1]:
                best = (troop, float(score), p.name)
    if best[1] < MIN_TROOP_AVATAR_SCORE:
        raise RuntimeError(
            "Troop avatar template match below threshold: "
            f"best_type={best[0]} score={best[1]:.3f} threshold={MIN_TROOP_AVATAR_SCORE:.3f} candidates={candidates}"
        )
    return best


def _load_fc_badge_templates() -> list[tuple[int, str, np.ndarray, np.ndarray]]:
    global _fc_badge_templates
    if _fc_badge_templates is not None:
        return _fc_badge_templates

    templates: list[tuple[int, str, np.ndarray, np.ndarray]] = []
    root = SKILL_DIR / "templates" / "fire_crystal_badges"
    for path in sorted(root.glob("fc*.png")):
        match = re.fullmatch(r"fc(\d+)\.png", path.name)
        if match is not None:
            tpl = cv2.imread(str(path), cv2.IMREAD_COLOR)
            if tpl is not None:
                templates.append((int(match.group(1)), path.name, _normalise_badge_for_match(tpl), tpl))

    for class_dir in sorted(path for path in root.glob("fc*") if path.is_dir()):
        match = re.fullmatch(r"fc(\d+)", class_dir.name)
        if match is None:
            continue
        fc_level = int(match.group(1))
        for path in sorted(class_dir.glob("*.png")):
            tpl = cv2.imread(str(path), cv2.IMREAD_COLOR)
            if tpl is None:
                continue
            templates.append((fc_level, path.name, _normalise_badge_for_match(tpl), tpl))
    _fc_badge_templates = templates
    return templates


def _normalise_badge_for_match(img_bgr: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    # Use saturation/value so badge shell and digit shape dominate while avatar
    # colour and local background matter less.
    return hsv[:, :, 1:3]


def _badge_digit_region(img_bgr: np.ndarray) -> np.ndarray:
    height, width = img_bgr.shape[:2]
    x1 = int(width * 0.28)
    x2 = max(x1 + 1, int(width * 0.78))
    y1 = int(height * 0.24)
    y2 = max(y1 + 1, int(height * 0.76))
    return cv2.cvtColor(img_bgr[y1:y2, x1:x2], cv2.COLOR_BGR2GRAY)


def _score_badge_digit(probe_bgr: np.ndarray, template_bgr: np.ndarray) -> float:
    probe = _badge_digit_region(probe_bgr)
    template = _badge_digit_region(template_bgr)
    if probe.size == 0 or template.size == 0:
        return -1.0
    best = -1.0
    for scale in (0.85, 1.0, 1.15, 1.3, 1.5, 1.7):
        th, tw = template.shape[:2]
        resized = cv2.resize(
            template,
            (max(3, int(tw * scale)), max(3, int(th * scale))),
            interpolation=cv2.INTER_AREA,
        )
        rh, rw = resized.shape[:2]
        ph, pw = probe.shape[:2]
        if rh > ph or rw > pw:
            continue
        score = float(cv2.minMaxLoc(cv2.matchTemplate(probe, resized, cv2.TM_CCOEFF_NORMED))[1])
        best = max(best, score)
    return best


def _is_star_badge_template(img_bgr: np.ndarray) -> bool:
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    magenta = cv2.inRange(hsv, (125, 45, 70), (169, 255, 255))
    return cv2.countNonZero(magenta) >= max(20, int(img_bgr.shape[0] * img_bgr.shape[1] * 0.08))


def _top_clipped_badge_template(template: np.ndarray, template_bgr: np.ndarray) -> np.ndarray | None:
    if not _is_star_badge_template(template_bgr):
        return None
    height = template.shape[0]
    y1 = int(height * 0.25)
    if height - y1 < 8:
        return None
    return template[y1:, :, :]


def _crop_to_largest_badge_contour(img_bgr: np.ndarray, mask: np.ndarray, *, pad_ratio: float = 0.22) -> np.ndarray | None:
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=1)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates: list[tuple[float, tuple[int, int, int, int]]] = []
    height, width = img_bgr.shape[:2]
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = float(cv2.contourArea(contour))
        if w * h < 60 or area < 20:
            continue
        if x + w / 2 < width * 0.28 or y + h / 2 > height * 0.88:
            continue
        candidates.append((area, (x, y, w, h)))
    if not candidates:
        return None
    _, (x, y, w, h) = max(candidates, key=lambda item: item[0])
    pad = int(max(w, h) * pad_ratio)
    x1 = max(0, x - pad)
    y1 = max(0, y - pad)
    x2 = min(width, x + w + pad)
    y2 = min(height, y + h + pad)
    return img_bgr[y1:y2, x1:x2]


def _isolate_badge_blob(img_bgr: np.ndarray) -> np.ndarray:
    if img_bgr.size == 0:
        return img_bgr
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    red = cv2.inRange(hsv, (0, 55, 70), (14, 255, 255)) | cv2.inRange(hsv, (165, 55, 70), (179, 255, 255))
    magenta = cv2.inRange(hsv, (125, 45, 70), (169, 255, 255))
    blue = cv2.inRange(hsv, (75, 45, 70), (125, 255, 255))

    star_badge = _crop_to_largest_badge_contour(img_bgr, magenta, pad_ratio=0.05)
    if star_badge is not None:
        return star_badge
    hex_badge = _crop_to_largest_badge_contour(img_bgr, red | blue, pad_ratio=0.22)
    if hex_badge is not None:
        return hex_badge
    return img_bgr


def _match_fire_crystal_badge_template(badge_bgr: np.ndarray) -> tuple[int | None, float, str]:
    templates = _load_fc_badge_templates()
    if not templates or badge_bgr.size == 0:
        return None, -1.0, "none"
    probe_bgr = _isolate_badge_blob(badge_bgr)

    def score_templates(*, clipped: bool) -> list[tuple[int, str, float, float]]:
        scores: list[tuple[int, str, float, float]] = []
        for fc_level, name, _tpl, tpl_bgr in templates:
            if clipped:
                tpl_to_match = _top_clipped_badge_template(tpl_bgr, tpl_bgr)
                if tpl_to_match is None:
                    continue
            else:
                tpl_to_match = tpl_bgr
            shell_score = -1.0
            for scale in FC_BADGE_TEMPLATE_SCALES:
                th, tw = tpl_to_match.shape[:2]
                resized = cv2.resize(tpl_to_match, (max(3, int(tw * scale)), max(3, int(th * scale))), interpolation=cv2.INTER_AREA)
                rh, rw = resized.shape[:2]
                ph, pw = probe_bgr.shape[:2]
                if rh > ph or rw > pw:
                    continue
                score = float(cv2.minMaxLoc(cv2.matchTemplate(probe_bgr, resized, cv2.TM_CCOEFF_NORMED))[1])
                shell_score = max(shell_score, score)
            digit_score = _score_badge_digit(probe_bgr, tpl_bgr) if fc_level in (6, 8) else shell_score
            scores.append((fc_level, name, shell_score, digit_score))
        return scores

    def choose(scores: list[tuple[int, str, float, float]]) -> tuple[int | None, float, str]:
        if not scores:
            return None, -1.0, "none"
        shell_sorted = sorted(scores, key=lambda item: item[2], reverse=True)
        chosen = shell_sorted[0]
        runner_up = shell_sorted[1] if len(shell_sorted) > 1 else None
        if runner_up is not None and {chosen[0], runner_up[0]} == {6, 8} and chosen[2] - runner_up[2] <= 0.04:
            chosen = max((chosen, runner_up), key=lambda item: item[3])
        return chosen[0], chosen[2], chosen[1]

    full_match = choose(score_templates(clipped=False))
    if full_match[0] is not None and full_match[1] >= MIN_FC_BADGE_TEMPLATE_SCORE:
        return full_match

    clipped_match = choose(score_templates(clipped=True))
    if clipped_match[0] is not None and clipped_match[1] > full_match[1]:
        return clipped_match
    return full_match


def _detect_fire_crystal_badge(slot_crop: np.ndarray, *, crop_from_slot: bool = True) -> int | None:
    fc_level, _score = _detect_fire_crystal_badge_match(slot_crop, crop_from_slot=crop_from_slot)
    return fc_level


def _detect_fire_crystal_badge_match(slot_crop: np.ndarray, *, crop_from_slot: bool = True) -> tuple[int | None, float]:
    """Read the fire-crystal badge number in the top-right of a troop slot.

    Returns ``None`` when no badge is visible or the match is not confident.
    """
    if slot_crop.size == 0:
        return None, -1.0
    h, w = slot_crop.shape[:2]
    if not crop_from_slot or (h <= 64 and w <= 64):
        badge = slot_crop
    else:
        top = max(1, int(h * 0.62))
        left = int(w * 0.28)
        badge = slot_crop[0:top, left:]
    hsv = cv2.cvtColor(badge, cv2.COLOR_BGR2HSV)
    red_mask = cv2.inRange(hsv, (0, 70, 80), (12, 255, 255)) | cv2.inRange(hsv, (165, 70, 80), (179, 255, 255))
    red_count = cv2.countNonZero(red_mask)
    if red_count < max(20, badge.shape[0] * badge.shape[1] * 0.04):
        return None, -1.0

    fc_level, score, template_name = _match_fire_crystal_badge_template(badge)
    if fc_level is not None and score >= MIN_FC_BADGE_TEMPLATE_SCORE:
        return fc_level, score

    return None, score


def _extract_typed_troops_from_slots(stats_result: dict[str, Any], img_bgr: np.ndarray) -> dict[str, list[dict[str, Any]]]:
    header = OCRItem(**stats_result["meta"]["header_box"])
    image_height, image_width = img_bgr.shape[:2]
    avatar_y1 = max(0, header.y1 - int(image_height * 0.135))
    avatar_y2 = max(avatar_y1 + 10, header.y1 - int(image_height * 0.052))
    details = {"left": [], "right": []}
    debug: list[dict[str, Any]] = []

    for side, slots in (("left", (0, 1, 2)), ("right", (3, 4, 5))):
        slot_counts: dict[int, int] = {}
        slot_avatars: dict[int, np.ndarray] = {}
        for slot in slots:
            side_slot = slot if side == "left" else slot - 3
            default_type = TROOP_TYPES[side_slot]
            count = stats_result.get("meta", {}).get("slot_counts", {}).get(str(slot))
            if count is None:
                count = stats_result[side]["troop_counts"].get(default_type)
            if count is None or count <= 0:
                continue
            cx = int(image_width * TROOP_SLOT_CENTERS[slot])
            half_width = int(image_width * TROOP_SLOT_HALF_WIDTH)
            x1 = max(0, cx - half_width)
            x2 = min(image_width, cx + half_width)
            slot_counts[slot] = int(count)
            slot_avatars[slot] = img_bgr[avatar_y1:avatar_y2, x1:x2]
            badge_x2 = min(image_width, x2 + int(round(image_width * 0.055)))
            count_box = stats_result.get("meta", {}).get("slot_count_boxes", {}).get(str(slot))
            if count_box is not None:
                count_item = OCRItem(**count_box)
                count_height = max(1, count_item.height)
                badge_y1 = max(0, count_item.y1 - int(round(4.5 * count_height)))
                badge_y2 = max(badge_y1 + 1, count_item.y1 - int(round(2.5 * count_height)))
                slot_crop = img_bgr[badge_y1:badge_y2, x1:badge_x2]
                count_fc, count_score = _detect_fire_crystal_badge_match(slot_crop, crop_from_slot=False)
            else:
                count_fc, count_score = None, -1.0
            fallback_crop = img_bgr[max(0, avatar_y1 - 12):avatar_y2, x1:badge_x2]
            fallback_fc, fallback_score = _detect_fire_crystal_badge_match(fallback_crop)
            fc_badge = count_fc if count_score >= fallback_score else fallback_fc
            if fc_badge is not None:
                stats_result.setdefault("meta", {}).setdefault("fire_crystal_badges", {})[str(slot)] = fc_badge

        occupied = sorted(slot_counts)
        if len(occupied) == 3:
            for slot, troop_type in zip(slots, TROOP_TYPES):
                match = ("positional", 1.0, "positional")
                _append_troop_detail(details, debug, stats_result, side, slot, troop_type, slot_counts[slot], match)
        elif len(occupied) == 2:
            first, second = occupied
            first_match = _best_avatar_match(slot_avatars[first], ("infantry", "lancer"))
            _append_troop_detail(details, debug, stats_result, side, first, first_match[0], slot_counts[first], first_match)
            if first_match[0] == "lancer":
                second_match = ("marksman", 1.0, "positional")
            else:
                second_match = _best_avatar_match(slot_avatars[second], ("lancer", "marksman"))
            _append_troop_detail(details, debug, stats_result, side, second, second_match[0], slot_counts[second], second_match)
        elif len(occupied) == 1:
            slot = occupied[0]
            match = _best_avatar_match(slot_avatars[slot], TROOP_TYPES)
            _append_troop_detail(details, debug, stats_result, side, slot, match[0], slot_counts[slot], match)

    stats_result["meta"]["troop_template_matches"] = debug
    return details


def _append_troop_detail(
    details: dict[str, list[dict[str, Any]]],
    debug: list[dict[str, Any]],
    stats_result: dict[str, Any],
    side: str,
    slot: int,
    troop_type: str,
    count: int,
    match: tuple[str, float, str],
) -> None:
    side_slot = slot if side == "left" else slot - 3
    positional_type = TROOP_TYPES[side_slot]
    level_info = stats_result[side]["levels"].get(positional_type, {})
    fc_level = 0
    badge_level = stats_result.get("meta", {}).get("fire_crystal_badges", {}).get(str(slot))
    if badge_level is not None:
        fc_level = None if badge_level == -1 else badge_level
    details[side].append(
        {
            "type": troop_type,
            "tier": level_info.get("tier"),
            "fire_crystal_level": fc_level,
            "count": count,
            "slot": slot,
        }
    )
    debug.append(
        {
            "side": side,
            "slot": slot,
            "positional_type": positional_type,
            "type": troop_type,
            "score": match[1],
            "template": match[2],
            "count": count,
        }
    )


def extract_report_stats_and_troops(image_path: str | Path, *, debug_outdir: str | None = None) -> dict[str, Any]:
    img_bgr = cv2.imread(str(image_path))
    if img_bgr is None:
        raise FileNotFoundError(f"Could not read image: {image_path}")
    image_height, image_width = img_bgr.shape[:2]

    # Template matching must use the original image so avatar and badge colours
    # stay comparable to templates. The common OCR path uses a faster detector
    # on the original report; enhanced/server OCR is retained as a fallback for
    # noisy or unfamiliar crops.
    ocr_input = _crop_report_panel_for_ocr(img_bgr)
    fast_original = _ocr_pass(ocr_input, fast=True)
    strategies = ["rapidocr:fast-panel-crop" if ocr_input.shape[:2] != img_bgr.shape[:2] else "rapidocr:fast-original"]
    try:
        result = extract_values_from_ocr_items(fast_original, image_width=image_width, image_height=image_height)
    except ValueError:
        result = None

    if result is None:
        strategies.append("rapidocr:enhanced")
        enhanced = _ocr_pass(img_bgr, scale=2.0, sharpen=True, clahe=True)
        try:
            result = extract_values_from_ocr_items(enhanced, image_width=image_width, image_height=image_height)
        except ValueError:
            result = None

    if result is None:
        strategies.append("rapidocr:original")
        original = _ocr_pass(img_bgr)
        result = extract_values_from_ocr_items(original, image_width=image_width, image_height=image_height)

    result["meta"]["ocr_strategy"] = strategies
    result["meta"]["template_match_image"] = "original"
    _finalize_troops_and_missing(result, img_bgr)
    if _needs_ocr_repair(result):
        strategies.append("targeted-fallback")
        result = _repair_missing_values(result, img_bgr)
        result["meta"]["ocr_strategy"] = strategies
        result["meta"]["template_match_image"] = "original"
        _finalize_troops_and_missing(result, img_bgr)

    result["image_path"] = str(Path(image_path).resolve())
    result["image_size"] = {"width": image_width, "height": image_height}

    if debug_outdir:
        outdir = Path(debug_outdir)
        outdir.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(
            str(outdir / "report_stats_parser_ocr_input.png"),
            _preprocess_image(img_bgr, scale=2.0, sharpen=True, clahe=True),
        )
        (outdir / "report_stats_parser_debug.json").write_text(_json_dumps(result))

    return result


def _troop_type_key(troop_type: str, tier: Any, fire_crystal_level: Any) -> str | None:
    if not isinstance(tier, int):
        return None
    if tier < 1:
        return None
    if isinstance(fire_crystal_level, int) and fire_crystal_level > 0:
        return f"{troop_type}_t{tier}_fc{fire_crystal_level}"
    return f"{troop_type}_t{tier}"


def shape_dashboard_side(side_data: dict[str, Any]) -> dict[str, Any]:
    """Map parser-native side data to the dashboard upload contract."""
    troops: dict[str, int | None] = {troop_type: None for troop_type in TROOP_TYPES}
    troop_types: dict[str, str | None] = {troop_type: None for troop_type in TROOP_TYPES}
    stats: dict[str, dict[str, float | None]] = {
        troop_type: {stat: None for stat in STAT_NAMES} for troop_type in TROOP_TYPES
    }

    for troop in side_data.get("troops", []):
        if not isinstance(troop, dict):
            continue
        troop_type = troop.get("type")
        if troop_type not in TROOP_TYPES:
            continue
        count = troop.get("count")
        if isinstance(count, int):
            troops[troop_type] = count
        troop_types[troop_type] = _troop_type_key(
            troop_type,
            troop.get("tier"),
            troop.get("fire_crystal_level"),
        )

    # Older fallback fields can still contain counts or levels when typed troop
    # details are incomplete.
    for troop_type, count in side_data.get("troop_counts", {}).items():
        if troop_type in TROOP_TYPES and troops[troop_type] is None and isinstance(count, int):
            troops[troop_type] = count

    for troop_type, level in side_data.get("levels", {}).items():
        if troop_type not in TROOP_TYPES or troop_types[troop_type] is not None:
            continue
        troop_types[troop_type] = _troop_type_key(
            troop_type,
            level.get("tier") if isinstance(level, dict) else None,
            level.get("fire_crystal_level") if isinstance(level, dict) else None,
        )

    for field, value in side_data.get("stat_bonuses", {}).items():
        if not isinstance(value, (int, float)):
            continue
        try:
            troop_type, stat = field.rsplit("_", 1)
        except ValueError:
            continue
        if troop_type in TROOP_TYPES and stat in STAT_NAMES:
            stats[troop_type][stat] = float(value)

    return {"troops": troops, "troop_types": troop_types, "stats": stats}


def dashboard_warnings_from_result(result: dict[str, Any]) -> list[str]:
    missing = result.get("meta", {}).get("missing_fields", [])
    if not missing:
        return []
    return ["missing fields: " + ", ".join(str(field) for field in missing)]


def shape_dashboard_report_result(result: dict[str, Any]) -> dict[str, Any]:
    strategies = result.get("meta", {}).get("ocr_strategy", [])
    return {
        "attacker": shape_dashboard_side(result["left"]),
        "defender": shape_dashboard_side(result["right"]),
        "raw_text": "",
        "warnings": dashboard_warnings_from_result(result),
        "ocr_retried": len(strategies) > 1,
        "parser": "skill.report_stats_parser",
    }


def parse_dashboard_report_bytes(image_bytes: bytes) -> dict[str, Any]:
    with tempfile.NamedTemporaryFile(suffix=".png") as tmp:
        tmp.write(image_bytes)
        tmp.flush()
        return shape_dashboard_report_result(extract_report_stats_and_troops(tmp.name))


def _json_dumps(data: Any) -> str:
    return json.dumps(data, indent=2, sort_keys=True) + "\n"


def _main() -> int:
    try:
        payload = json.load(sys.stdin)
        encoded = payload.get("image_base64") if isinstance(payload, dict) else None
        if not isinstance(encoded, str) or not encoded:
            raise ValueError("Missing 'image_base64' field in request body")
        image_bytes = base64.b64decode(encoded)
        sys.stdout.write(_json_dumps(parse_dashboard_report_bytes(image_bytes)))
        return 0
    except Exception as exc:  # noqa: BLE001 - CLI must return JSON errors.
        sys.stdout.write(_json_dumps({"error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(_main())
