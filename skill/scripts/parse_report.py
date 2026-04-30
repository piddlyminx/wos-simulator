#!/usr/bin/env python3
"""Parse a Whiteout Survival battle report from top + bottom screenshots.

Anchoring:  cv2 template matching against header images.
Numbers:    RapidOCR (primary) with CRNN-CTC and Tesseract fallbacks.
Names:      RapidOCR (PaddleOCR v5 ONNX) with sharpening.

Usage:
    parse_report.py <top_screenshot> [bottom_screenshot]
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image
from ocr import RapidOCR

# ── Paths ──────────────────────────────────────────────────────────────────────
SKILL_DIR  = Path(__file__).resolve().parent.parent
TPL_BATTLE = SKILL_DIR / "templates" / "tpl_battle_overview.png"
ONNX_MODEL = SKILL_DIR / "models"    / "wos_ocr.onnx"

# Offset from template top-left y to anchor origin.
BO_ANCHOR_OFFSET = 12
SB_ANCHOR_OFFSET = 12
MIN_HEADER_TEMPLATE_SCORE = 0.78

# ── CRNN-CTC charset ──────────────────────────────────────────────────────────
CHARS    = "+-,.0123456789%"
IDX2CHAR = {i + 1: c for i, c in enumerate(CHARS)}
IMG_H, IMG_W = 32, 160   # model input size

# ── Crop geometry — Top screenshot (relative to Battle Overview anchor) ───────
_NAME_Y  = (172, 204)
_OUTCOME_ROWS = {
    "troops":          (326, 356),
    "losses":          (384, 414),
    "injured":         (442, 472),
    "lightly_injured": (500, 530),
    "survivors":       (558, 588),
}
_LEFT_NAME_X  = (25,  335)
_RIGHT_NAME_X = (385, 695)
_LEFT_OUTCOME_X  = (105, 255)
_RIGHT_OUTCOME_X = (476, 615)

_SB_LABELS  = [
    "infantry_attack",  "infantry_defense",  "infantry_lethality",  "infantry_health",
    "lancer_attack",    "lancer_defense",    "lancer_lethality",    "lancer_health",
    "marksman_attack",  "marksman_defense",  "marksman_lethality",  "marksman_health",
]
TROOP_TYPES = ("infantry", "lancer", "marksman")

# Sharpen kernel for name crops
_SHARPEN = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]], dtype=np.float32)


# ── Singletons (lazy-loaded) ──────────────────────────────────────────────────
_onnx_sess: ort.InferenceSession | None = None
_rapid_ocr: RapidOCR | None = None


def _get_onnx() -> ort.InferenceSession:
    global _onnx_sess
    if _onnx_sess is None:
        _onnx_sess = ort.InferenceSession(str(ONNX_MODEL))
    return _onnx_sess


def _get_rapid() -> RapidOCR:
    global _rapid_ocr
    if _rapid_ocr is None:
        _rapid_ocr = RapidOCR()
    return _rapid_ocr


# ── Low-level helpers ──────────────────────────────────────────────────────────
def _match_template(img_bgr: np.ndarray, tpl_bgr: np.ndarray) -> tuple[int, int, float]:
    """Return (x, y, score) of best template match."""
    res = cv2.matchTemplate(
        cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY),
        cv2.cvtColor(tpl_bgr, cv2.COLOR_BGR2GRAY),
        cv2.TM_CCOEFF_NORMED,
    )
    _, score, _, (x, y) = cv2.minMaxLoc(res)
    return x, y, score


def _require_template_anchor(
    img_bgr: np.ndarray,
    tpl_bgr: np.ndarray,
    label: str,
    source_path: str,
    min_score: float = MIN_HEADER_TEMPLATE_SCORE,
) -> tuple[int, int]:
    x, y, score = _match_template(img_bgr, tpl_bgr)
    if score < min_score:
        raise RuntimeError(
            f"{label} template match below threshold in {source_path}: "
            f"score={score:.3f}, threshold={min_score:.3f}"
        )
    return x, y


def _safe_crop(img: np.ndarray, x1: int, y1: int, x2: int, y2: int) -> np.ndarray:
    h, w = img.shape[:2]
    return img[max(0, y1):min(h, y2), max(0, x1):min(w, x2)]


def _crop_gray(img_bgr: np.ndarray, x1: int, y1: int, x2: int, y2: int) -> np.ndarray:
    crop = _safe_crop(img_bgr, x1, y1, x2, y2)
    if crop.size == 0:
        return np.zeros((1, 1), dtype=np.uint8)
    return cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)


# ── OCR engines ────────────────────────────────────────────────────────────────
def _ocr_crnn(gray: np.ndarray, sharpen: bool = False) -> str:
    """Run the CRNN-CTC model on a grayscale crop."""
    if gray.size == 0:
        return ""
    if sharpen:
        gray = cv2.filter2D(gray, -1, _SHARPEN)
    pil = Image.fromarray(gray).convert("L")
    w, h = pil.size
    pil = pil.resize((min(int(w * IMG_H / h), IMG_W), IMG_H), Image.BILINEAR)
    padded = Image.new("L", (IMG_W, IMG_H), 255)
    padded.paste(pil, (0, 0))
    arr = np.array(padded, dtype=np.float32)[np.newaxis, np.newaxis] / 255.0
    logits = _get_onnx().run(None, {"image": arr})[0][:, 0, :]
    indices = logits.argmax(axis=1)
    chars, prev = [], 0
    for idx in indices:
        if idx != 0 and idx != prev and idx in IDX2CHAR:
            chars.append(IDX2CHAR[idx])
        prev = idx
    return "".join(chars)


# ── Parsing helpers ────────────────────────────────────────────────────────────
def _parse_int(s: str) -> int:
    cleaned = re.sub(r"[^0-9]", "", s) if s else ""
    return int(cleaned) if cleaned else 0


def _write_debug_json(debug_outdir: str | None, filename: str, data: object) -> None:
    if not debug_outdir:
        return
    outdir = Path(debug_outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / filename).write_text(json.dumps(data, indent=2) + "\n")


def _write_debug_crop(debug_outdir: str | None, filename: str, crop: np.ndarray) -> None:
    if not debug_outdir:
        return
    outdir = Path(debug_outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(outdir / filename), crop)


def _read_name(img_bgr: np.ndarray, x1: int, y1: int, x2: int, y2: int) -> str:
    """Read a player/enemy name with RapidOCR (sharpened, then unsharpened fallback)."""
    crop = _safe_crop(img_bgr, x1, y1, x2, y2)
    if crop.size == 0:
        return ""
    # Try sharpened first (better for clean text)
    sharp = cv2.filter2D(crop, -1, _SHARPEN)
    result = _get_rapid()(sharp)
    if result and result[0]:
        return " ".join(r[1] for r in result[0])
    # Fallback: unsharpened color crop
    result = _get_rapid()(crop)
    if result and result[0]:
        return " ".join(r[1] for r in result[0])
    return ""


def _detect_roles(img_bgr: np.ndarray, anchor_y: int) -> tuple[str, str]:
    """Red banner = attacker, blue = defender."""
    y = anchor_y + 55
    if y >= img_bgr.shape[0]:
        return "attacker", "defender"
    left_bgr = img_bgr[y, 150:250, :].mean(axis=0)
    return ("attacker", "defender") if left_bgr[2] > left_bgr[0] else ("defender", "attacker")


# ── Public API ─────────────────────────────────────────────────────────────────
def parse_battle_report(
    top_path: str,
    stats_path: str | None = None,
    tpc_path: str | None = None,
    debug_outdir: str | None = None,
) -> dict:
    """Parse a battle report from screenshots.

    Args:
        top_path:    Screenshot taken at the top of the report (Battle Overview).
        stats_path: Screenshot containing troop slots and full Stat Bonuses.
        tpc_path:   Deprecated compatibility argument; ignored by the unified parser.

    Returns:
        dict with keys: result, left, right.
    """
    top = cv2.imread(top_path)
    if top is None:
        raise FileNotFoundError(f"Cannot read: {top_path}")

    tpl_bo = cv2.imread(str(TPL_BATTLE))
    if tpl_bo is None:
        raise FileNotFoundError(f"Missing template: {TPL_BATTLE}")
    _, bo_y = _require_template_anchor(top, tpl_bo, "Battle Overview", top_path)
    anchor = bo_y + BO_ANCHOR_OFFSET

    # ── Roles ──────────────────────────────────────────────────────────────────
    left_role, right_role = _detect_roles(top, anchor)

    # ── Names ──────────────────────────────────────────────────────────────────
    ny1, ny2 = anchor + _NAME_Y[0], anchor + _NAME_Y[1]
    left_name  = _read_name(top, _LEFT_NAME_X[0],  ny1, _LEFT_NAME_X[1],  ny2)
    right_name = _read_name(top, _RIGHT_NAME_X[0], ny1, _RIGHT_NAME_X[1], ny2)

    # ── Outcome rows (CRNN) ───────────────────────────────────────────────────
    outcome: dict[str, int] = {}
    outcome_debug: list[dict[str, object]] = []
    for field, (off_y1, off_y2) in _OUTCOME_ROWS.items():
        sy1, sy2 = anchor + off_y1, anchor + off_y2
        for side, (sx1, sx2) in [("left", _LEFT_OUTCOME_X), ("right", _RIGHT_OUTCOME_X)]:
            gray = _crop_gray(top, sx1, sy1, sx2, sy2)
            raw_text = _ocr_crnn(gray)
            value = _parse_int(raw_text)
            outcome[f"{side}_{field}"] = value
            crop_name = f"outcome_{side}_{field}.png"
            _write_debug_crop(debug_outdir, crop_name, gray)
            outcome_debug.append({
                "side": side,
                "field": field,
                "crop": crop_name,
                "box": {"x1": sx1, "y1": sy1, "x2": sx2, "y2": sy2},
                "ocr_text": raw_text,
                "value": value,
            })
    _write_debug_json(debug_outdir, "outcome_crnn_debug.json", outcome_debug)

    # ── Unified troop/stat screenshot ──────────────────────────────────────────
    troop_power:  dict[str, int]   = {}
    stat_bonuses: dict[str, float] = {}
    troop_details: dict[str, list[dict]] = {"left": [], "right": []}
    parser_meta: dict[str, object] = {}

    stats_source_path = stats_path or tpc_path
    if stats_source_path:
        from report_stats_parser import extract_report_stats_and_troops

        parsed_stats = extract_report_stats_and_troops(stats_source_path, debug_outdir=debug_outdir)
        parsed_stats.setdefault("meta", {})["sources"] = {
            "stats": str(stats_source_path),
            "troops": str(stats_source_path),
        }
        parser_meta = parsed_stats.get("meta", {})
        for side in ("left", "right"):
            for label, value in parsed_stats[side].get("stat_bonuses", {}).items():
                stat_bonuses[f"{side}_{label}"] = value
            for troop in parsed_stats[side].get("troops", []):
                troop_type = troop.get("type")
                if troop_type in TROOP_TYPES:
                    troop_power[f"{side}_{troop_type}"] = int(troop.get("count") or 0)
            troop_details[side] = parsed_stats[side].get("troops", [])

    # ── Winner ─────────────────────────────────────────────────────────────────
    l_surv = outcome.get("left_survivors", 0)
    r_surv = outcome.get("right_survivors", 0)
    if l_surv > 0 and r_surv == 0:
        result = "left_wins"
    elif r_surv > 0 and l_surv == 0:
        result = "right_wins"
    else:
        result = "draw"

    # ── Assemble output ────────────────────────────────────────────────────────
    def _side(prefix: str, role: str, name: str) -> dict:
        side = {
            "role": role,
            "name": name,
            "troops":          outcome.get(f"{prefix}_troops", 0),
            "losses":          outcome.get(f"{prefix}_losses", 0),
            "injured":         outcome.get(f"{prefix}_injured", 0),
            "lightly_injured": outcome.get(f"{prefix}_lightly_injured", 0),
            "survivors":       outcome.get(f"{prefix}_survivors", 0),
        }
        if troop_power:
            side["troop_power"] = {
                t: troop_power.get(f"{prefix}_{t}", 0)
                for t in ("infantry", "lancer", "marksman")
            }
        if stat_bonuses:
            side["stat_bonuses"] = {
                label: stat_bonuses.get(f"{prefix}_{label}", 0.0)
                for label in _SB_LABELS
            }
        if troop_details.get(prefix):
            side["troops_detail"] = troop_details[prefix]
        return side

    parsed = {
        "result": result,
        "left":   _side("left",  left_role,  left_name),
        "right":  _side("right", right_role, right_name),
    }
    if parser_meta:
        parsed["parser_meta"] = parser_meta
    return parsed
