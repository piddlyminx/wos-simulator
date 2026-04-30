"""
parse_refine.py — OCR and parse the 6 stat rows on the pet Refine tab.
"""
from __future__ import annotations

import re
from typing import Optional

import cv2
import numpy as np
from ocr import RapidOCR

_ocr = RapidOCR()

# Fixed stat names in row order (always Infantry / Lancer / Marksman, Lethality / Health)
REFINE_STAT_NAMES = [
    "Infantry Lethality",
    "Infantry Health",
    "Lancer Lethality",
    "Lancer Health",
    "Marksman Lethality",
    "Marksman Health",
]

# Row y-ranges in a 720×1280 screenshot
REFINE_ROW_Y = [
    (432, 508),
    (512, 588),
    (592, 668),
    (672, 748),
    (752, 828),
    (832, 908),
]

_VX1, _VX2 = 270, 680       # x crop for values + delta
_DX1, _DX2 = 500, 680       # x crop for delta colour sampling
_CX1, _CX2 = 50,  200       # x crop for background colour classification

_VALUE_RE = re.compile(r'(\d+\.\d+)%/(\d+\.\d+)%')
_DELTA_RE = re.compile(r'([+-]?\d+\.\d+)%')


def _classify_bg_color(img_bgr: np.ndarray, y1: int, y2: int) -> str:
    """
    Classify the background colour of a stat row.

    Samples the inner label area (x=50–200, inset vertically by 1/6 of row height)
    and returns one of: 'blue', 'purple', 'orange', 'green', 'grey'.

    Blue vs purple is determined by the sign of (G − R):
      blue:   G > R  (G-R ≈ +48 to +53)
      purple: R > G  (G-R ≈ -14 to -16)
    Orange/green/grey are distinguished by the dominant channel.
    """
    pad = (y2 - y1) // 6
    region = img_bgr[y1 + pad:y2 - pad, _CX1:_CX2].astype(float)
    b, g, r = region.mean(axis=(0, 1))

    if b > r and b > g:          # Blue family (B dominant)
        return 'blue' if g > r else 'purple'
    if r > g and r > b:          # Orange (R dominant)
        return 'orange'
    if g > r and g > b:          # Green (G dominant)
        return 'green'
    return 'grey'


def _delta_sign(img_bgr: np.ndarray, y1: int, y2: int) -> Optional[int]:
    """
    Return +1 (green), -1 (red), or None (no delta) by counting
    clearly saturated pixels in the delta region.
    """
    region = img_bgr[y1:y2, _DX1:_DX2].astype(float)
    b, g, r = region[:, :, 0], region[:, :, 1], region[:, :, 2]
    green = int(((g > 120) & (g > r * 1.8) & (g > b * 1.5)).sum())
    red   = int(((r > 120) & (r > g * 1.8) & (r > b * 1.5)).sum())
    if green > 50:
        return +1
    if red > 50:
        return -1
    return None


def parse_refine_stats(img_bgr: np.ndarray) -> list[dict]:
    """
    Parse the 6 refinement stat rows from a 720×1280 pet Refine tab screenshot.

    Returns a list of 6 dicts::

        {
          "stat":    "Infantry Lethality",
          "color":   "blue",   # grey | green | blue | purple | orange
          "current": 15.15,
          "max":     24.58,
          "delta":   -0.02,   # None if no delta shown
        }
    """
    results = []
    for name, (y1, y2) in zip(REFINE_STAT_NAMES, REFINE_ROW_Y):
        # OCR the values/delta portion, scaled up 3× for accuracy
        crop = img_bgr[y1:y2, _VX1:_VX2]
        h, w = crop.shape[:2]
        big = cv2.resize(crop, (w * 3, h * 3), interpolation=cv2.INTER_CUBIC)
        ocr_result, _ = _ocr(big)
        combined = " ".join(r[1] for r in ocr_result) if ocr_result else ""

        val_m = _VALUE_RE.search(combined)
        current = float(val_m.group(1)) if val_m else None
        max_val = float(val_m.group(2)) if val_m else None

        delta: Optional[float] = None
        remaining = combined[val_m.end():] if val_m else combined
        delta_m = _DELTA_RE.search(remaining)
        if delta_m:
            raw = float(delta_m.group(1))
            sign = _delta_sign(img_bgr, y1, y2)
            if delta_m.group(1)[0] == '-':
                delta = raw       # already negative from regex
            elif delta_m.group(1)[0] == '+':
                delta = raw       # already positive
            else:
                delta = raw * (sign if sign is not None else 1)

        color = _classify_bg_color(img_bgr, y1, y2)
        results.append({"stat": name, "color": color, "current": current, "max": max_val, "delta": delta})
    return results
