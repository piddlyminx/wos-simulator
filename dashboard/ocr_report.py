"""Parse a WOS battle-report screenshot into structured JSON.

Reads a base64-encoded image from stdin, runs Tesseract OCR, and extracts:
  - 3 troop counts per side (attacker left, defender right)
  - 12 stat-bonus percentages per side (4 stats x 3 troop types)

Output JSON (stdout):
  {
    "attacker": { "troops": {..}, "stats": {..} },
    "defender": { "troops": {..}, "stats": {..} },
    "raw_text": "...",
    "warnings": ["..."]
  }

On OCR/parse failure, exits non-zero with JSON error on stdout.
"""

from __future__ import annotations

import base64
import io
import json
import re
import sys
from typing import Any

from PIL import Image
import pytesseract


CATEGORIES = ("infantry", "lancer", "marksman")
STAT_NAMES = ("attack", "defense", "lethality", "health")

# Fixed row order in the report's Stat Bonuses section.
STAT_ROW_ORDER: list[tuple[str, str]] = [
    ("infantry", "attack"),
    ("infantry", "defense"),
    ("infantry", "lethality"),
    ("infantry", "health"),
    ("lancer", "attack"),
    ("lancer", "defense"),
    ("lancer", "lethality"),
    ("lancer", "health"),
    ("marksman", "attack"),
    ("marksman", "defense"),
    ("marksman", "lethality"),
    ("marksman", "health"),
]


def _ocr(image_bytes: bytes) -> str:
    img = Image.open(io.BytesIO(image_bytes))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    return pytesseract.image_to_string(img, config="--psm 6")


def _parse_troop_line(lines: list[str]) -> tuple[list[int], str | None]:
    """Find the first line containing 6 integers (commas allowed, no decimals).

    Returns (counts, source_line). counts may have fewer than 6 entries if OCR failed.
    """
    int_re = re.compile(r"(?<![\d.])\d{1,3}(?:,\d{3})+|(?<![\d.])\d{3,}(?![\d.])")
    for line in lines:
        matches = int_re.findall(line)
        if len(matches) >= 6:
            counts = [int(m.replace(",", "")) for m in matches[:6]]
            return counts, line
    # Fallback: any line with 6+ numbers at all (includes short ones).
    loose_re = re.compile(r"(?<![\d.])\d[\d,]*(?![\d.])")
    for line in lines:
        matches = [m for m in loose_re.findall(line) if m.replace(",", "").isdigit()]
        if len(matches) >= 6:
            counts = [int(m.replace(",", "")) for m in matches[:6]]
            return counts, line
    return [], None


def _parse_stats(lines: list[str]) -> tuple[dict[tuple[str, str], tuple[float, float]], list[str]]:
    """Extract stat-bonus percentages keyed by (category, stat_name).

    Rows match: `+<left>% <Stat Label> +<right>%`. Returns a dict and any warnings.
    """
    warnings: list[str] = []
    out: dict[tuple[str, str], tuple[float, float]] = {}

    # Accept optional leading non-digit noise, then two percentages sandwiching a label.
    # OCR sometimes drops the '+' sign, so it's optional.
    pct = r"[+\-]?\d+(?:\.\d+)?"
    row_re = re.compile(
        rf"({pct})\s*%\s+(.+?)\s+({pct})\s*%"
    )

    for line in lines:
        # Strip common non-alpha noise at the start (e.g. "C2 +1586.5%") and end.
        cleaned = re.sub(r"^[^+\-\d]*", "", line.strip())
        m = row_re.search(cleaned)
        if not m:
            continue
        left_raw, label, right_raw = m.group(1), m.group(2), m.group(3)
        try:
            left = float(left_raw)
            right = float(right_raw)
        except ValueError:
            continue
        key = _match_stat_label(label)
        if key is None:
            continue
        if key in out:
            warnings.append(f"duplicate stat row for {key[0]} {key[1]!r} - keeping first")
            continue
        out[key] = (left, right)

    missing = [k for k in STAT_ROW_ORDER if k not in out]
    if missing:
        warnings.append(
            "missing stat rows: "
            + ", ".join(f"{c} {s}" for c, s in missing)
        )
    return out, warnings


def _match_stat_label(label: str) -> tuple[str, str] | None:
    """Normalize an OCR'd stat label like 'Infantry Attack' or 'InfantryDefense'."""
    # Collapse whitespace + remove punctuation.
    norm = re.sub(r"[^A-Za-z]", "", label).lower()
    for cat in CATEGORIES:
        if norm.startswith(cat):
            rest = norm[len(cat):]
            for stat in STAT_NAMES:
                if rest == stat:
                    return (cat, stat)
    return None


def _shape_side(
    counts: list[int],
    stats: dict[tuple[str, str], tuple[float, float]],
    side: str,
) -> dict[str, Any]:
    side_idx = 0 if side == "attacker" else 1
    troop_base = 0 if side == "attacker" else 3
    troops: dict[str, int | None] = {}
    for i, cat in enumerate(CATEGORIES):
        idx = troop_base + i
        troops[cat] = counts[idx] if idx < len(counts) else None
    stat_out: dict[str, dict[str, float | None]] = {
        cat: {stat: None for stat in STAT_NAMES} for cat in CATEGORIES
    }
    for (cat, stat), pair in stats.items():
        stat_out[cat][stat] = pair[side_idx]
    return {"troops": troops, "stats": stat_out}


def parse_report(image_bytes: bytes) -> dict[str, Any]:
    text = _ocr(image_bytes)
    raw_lines = text.splitlines()
    lines = [l.strip() for l in raw_lines if l.strip()]

    counts, troop_line = _parse_troop_line(lines)
    stats, warnings = _parse_stats(lines)

    if len(counts) < 6:
        warnings.append(
            f"could not parse 6 troop counts (found {len(counts)}); check the image crop"
        )

    return {
        "attacker": _shape_side(counts, stats, "attacker"),
        "defender": _shape_side(counts, stats, "defender"),
        "raw_text": text,
        "warnings": warnings,
    }


def main() -> int:
    raw = sys.stdin.buffer.read()
    if not raw:
        print(json.dumps({"error": "no image data on stdin"}))
        return 2
    try:
        # Payload may be bare base64 or a JSON body with a "image_base64" field.
        data_b64: str
        stripped = raw.strip()
        if stripped[:1] == b"{":
            payload = json.loads(stripped)
            data_b64 = payload.get("image_base64", "")
            if not data_b64:
                print(json.dumps({"error": "missing image_base64 in JSON payload"}))
                return 2
        else:
            data_b64 = stripped.decode("utf-8", errors="ignore")
        # Strip a data URL prefix if present.
        if "," in data_b64 and data_b64.lstrip().startswith("data:"):
            data_b64 = data_b64.split(",", 1)[1]
        image_bytes = base64.b64decode(data_b64)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"error": f"failed to decode image: {e}"}))
        return 2

    try:
        result = parse_report(image_bytes)
    except pytesseract.TesseractNotFoundError:
        print(json.dumps({"error": "tesseract binary not installed"}))
        return 3
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"error": f"ocr failed: {e}"}))
        return 4

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
