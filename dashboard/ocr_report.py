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

Robustness strategy (WOS-207):
  1. First pass: PSM 6 on the uploaded image, via image_to_data so we keep
     per-line Y bounding boxes. Parse stat rows / troop counts.
  2. If any of the 12 stat rows (or 6 troop counts) are missing, retry the
     full image with progressively stronger preprocessing variants
     (upscale, autocontrast, binarize). Merge any newly-parsed rows in.
  3. If rows are *still* missing, use the Y positions of the rows we did
     find to linearly predict where the missing rows must be, crop a tight
     horizontal band around each predicted Y, and run targeted OCR on that
     band with PSM 7 plus upscale/autocontrast variants.

Recovery from steps 2-3 is silent (no warning) so long as the final result
is complete. Warnings are only emitted for rows that remained unrecovered
after every retry, or for truly odd cases (duplicate rows).
"""

from __future__ import annotations

import base64
import io
import json
import re
import sys
from typing import Any, Iterable

from PIL import Image, ImageOps
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

StatKey = tuple[str, str]
StatPair = tuple[float, float]
Word = dict[str, Any]  # {"text": str, "left": int, "right": int, ...}
Line = dict[str, Any]  # {"text": str, "top": int, "bottom": int, "words": [Word]}


# ---------------------------------------------------------------------------
# OCR wrappers
# ---------------------------------------------------------------------------


def _ocr_lines(img: Image.Image, config: str = "--psm 6") -> tuple[list[Line], str]:
    """Run Tesseract and return (lines_with_positions, full_text).

    Each line is ``{"text": "<joined words>", "top": int, "bottom": int}``
    where ``top``/``bottom`` are pixel Y coordinates in the input image.
    """
    data = pytesseract.image_to_data(
        img, config=config, output_type=pytesseract.Output.DICT
    )
    # Group word-level results by (block, paragraph, line).
    bucket: dict[tuple[int, int, int], dict[str, Any]] = {}
    n = len(data.get("text", []))
    for i in range(n):
        txt = (data["text"][i] or "").strip()
        if not txt:
            continue
        key = (
            int(data["block_num"][i]),
            int(data["par_num"][i]),
            int(data["line_num"][i]),
        )
        top = int(data["top"][i])
        bot = top + int(data["height"][i])
        left = int(data["left"][i])
        right = left + int(data["width"][i])
        entry = bucket.setdefault(key, {"words": [], "top": top, "bottom": bot})
        entry["words"].append(
            {
                "text": txt,
                "left": left,
                "right": right,
                "top": top,
                "bottom": bot,
            }
        )
        entry["top"] = min(entry["top"], top)
        entry["bottom"] = max(entry["bottom"], bot)
    lines: list[Line] = []
    for entry in bucket.values():
        words = sorted(entry["words"], key=lambda word: word["left"])
        lines.append(
            {
                "text": " ".join(word["text"] for word in words),
                "top": entry["top"],
                "bottom": entry["bottom"],
                "words": words,
            }
        )
    lines.sort(key=lambda e: (e["top"] + e["bottom"]) / 2)
    full_text = "\n".join(l["text"] for l in lines)
    return lines, full_text


# ---------------------------------------------------------------------------
# Preprocessing variants for retry
# ---------------------------------------------------------------------------


def _upscale(img: Image.Image, factor: int = 2) -> Image.Image:
    return img.resize((img.width * factor, img.height * factor), Image.LANCZOS)


def _autocontrast(img: Image.Image, cutoff: int = 2) -> Image.Image:
    return ImageOps.autocontrast(img.convert("L"), cutoff=cutoff)


def _binarize(img: Image.Image, threshold: int = 160) -> Image.Image:
    gray = img.convert("L")
    return gray.point(lambda p: 255 if p > threshold else 0)


def _full_image_retry_variants(
    img: Image.Image,
) -> Iterable[tuple[str, Image.Image, str]]:
    """Yield (name, preprocessed_image, tesseract_config) for full-image retries.

    Ordered from cheapest-likely-to-help to most aggressive.
    """
    yield ("upscale2x", _upscale(img), "--psm 6")
    yield ("autocontrast", _autocontrast(img), "--psm 6")
    yield ("upscale2x_autocontrast", _autocontrast(_upscale(img)), "--psm 6")
    yield ("binarize", _binarize(img), "--psm 6")
    yield ("upscale2x_binarize", _binarize(_upscale(img), threshold=170), "--psm 6")


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


# Accept optional leading non-digit noise, then two percentages sandwiching a
# label. OCR sometimes drops the '+' sign, so it's optional.
_PCT = r"[+\-]?\d+(?:\.\d+)?"
_ROW_RE = re.compile(rf"({_PCT})\s*%\s+(.+?)\s+({_PCT})\s*%")


def _match_stat_label(label: str) -> StatKey | None:
    """Normalize an OCR'd stat label like 'Infantry Attack' or 'InfantryDefense'."""
    norm = re.sub(r"[^A-Za-z]", "", label).lower()
    for cat in CATEGORIES:
        if norm.startswith(cat):
            rest = norm[len(cat):]
            for stat in STAT_NAMES:
                if rest == stat:
                    return (cat, stat)
    return None


def _parse_stat_row_from_text(text: str) -> tuple[StatKey, StatPair] | None:
    """Try to pull a single (key, (left, right)) from one textual line."""
    cleaned = re.sub(r"^[^+\-\d]*", "", text.strip())
    m = _ROW_RE.search(cleaned)
    if not m:
        return None
    left_raw, label, right_raw = m.group(1), m.group(2), m.group(3)
    try:
        left = float(left_raw)
        right = float(right_raw)
    except ValueError:
        return None
    key = _match_stat_label(label)
    if key is None:
        return None
    return key, (left, right)


def _parse_stats(
    lines: list[Line],
) -> tuple[dict[StatKey, StatPair], dict[StatKey, float], list[str]]:
    """Extract stat-bonus percentages from OCR lines with Y positions.

    Returns (stats_by_key, center_y_by_key, warnings). ``center_y_by_key``
    gives the vertical midpoint of the line that matched each stat row in
    the current image's coordinate system.
    """
    warnings: list[str] = []
    out: dict[StatKey, StatPair] = {}
    center_y: dict[StatKey, float] = {}

    for line in lines:
        parsed = _parse_stat_row_from_text(line["text"])
        if parsed is None:
            continue
        key, pair = parsed
        if key in out:
            warnings.append(
                f"duplicate stat row for {key[0]} {key[1]!r} - keeping first"
            )
            continue
        out[key] = pair
        center_y[key] = (line["top"] + line["bottom"]) / 2.0
    return out, center_y, warnings


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
    loose_re = re.compile(r"(?<![\d.])\d[\d,]*(?![\d.])")
    for line in lines:
        matches = [m for m in loose_re.findall(line) if m.replace(",", "").isdigit()]
        if len(matches) >= 6:
            counts = [int(m.replace(",", "")) for m in matches[:6]]
            return counts, line
    return [], None


def _normalize_letters(text: str) -> str:
    return re.sub(r"[^A-Za-z]", "", text).lower()


def _is_stat_bonuses_header(text: str) -> bool:
    return "statbonuses" in _normalize_letters(text)


def _clean_count_token(text: str) -> str:
    return re.sub(r"^[^\d]+|[^\d]+$", "", text.strip())


_COUNT_TOKEN_RE = re.compile(r"\d{1,3}(?:[.,\s]\d{3})+|(?<!\d)\d{3,7}(?!\d)")


def _parse_count_token(text: str) -> int | None:
    cleaned = _clean_count_token(text)
    if not cleaned or "%" in cleaned:
        return None
    if re.fullmatch(r"\d{1,3}(?:[.,\s]\d{3})+|\d{3,7}", cleaned) is None:
        return None
    digits = re.sub(r"\D", "", cleaned)
    if len(digits) < 3:
        return None
    return int(digits)


def _extract_count_candidates(line: Line) -> list[tuple[float, int]]:
    words = sorted(line.get("words") or [], key=lambda word: word["left"])
    if not words:
        return []

    out: list[tuple[float, int]] = []
    i = 0
    while i < len(words):
        matched = False
        max_span = min(3, len(words) - i)
        for span in range(max_span, 1, -1):
            chunk = words[i : i + span]
            if not all(
                re.fullmatch(r"\d{1,3}", _clean_count_token(word["text"]) or "")
                for word in chunk
            ):
                continue
            gaps = [
                chunk[idx + 1]["left"] - chunk[idx]["right"]
                for idx in range(len(chunk) - 1)
            ]
            min_width = min(word["right"] - word["left"] for word in chunk)
            if gaps and max(gaps) > max(8, int(min_width * 0.35)):
                continue
            merged_text = " ".join(word["text"] for word in chunk)
            value = _parse_count_token(merged_text)
            if value is None:
                continue
            out.append(((chunk[0]["left"] + chunk[-1]["right"]) / 2.0, value))
            i += span
            matched = True
            break
        if matched:
            continue

        word = words[i]
        text = word["text"]
        direct = _parse_count_token(text)
        if direct is not None:
            out.append(((word["left"] + word["right"]) / 2.0, direct))
            i += 1
            continue

        matches = list(_COUNT_TOKEN_RE.finditer(text))
        if matches:
            span_width = max(word["right"] - word["left"], 1)
            for idx, match in enumerate(matches):
                value = _parse_count_token(match.group(0))
                if value is None:
                    continue
                frac = (idx + 0.5) / len(matches)
                cx = word["left"] + span_width * frac
                out.append((cx, value))
        i += 1

    return out


def _format_mapped_categories(counts: list[int]) -> str:
    return ", ".join(CATEGORIES[: len(counts)])


def _parse_troop_row(
    line: Line,
    mid_x: float,
) -> tuple[dict[str, list[int]], list[str], str]:
    counts_by_side = {"attacker": [], "defender": []}
    warnings: list[str] = []
    text = line.get("text", "")

    if "%" in text:
        warnings.append(
            "troop row shows percentages rather than absolute counts; troop counts "
            "were left blank. Populate them manually or retry with a report that "
            "shows absolute troop numbers."
        )
        return counts_by_side, warnings, "percentage"

    for cx, value in sorted(_extract_count_candidates(line), key=lambda item: item[0]):
        side = "attacker" if cx < mid_x else "defender"
        counts_by_side[side].append(value)

    total_counts = sum(len(values) for values in counts_by_side.values())
    if total_counts == 0:
        return counts_by_side, warnings, "no_counts"

    for side in ("attacker", "defender"):
        side_counts = counts_by_side[side]
        if len(side_counts) > len(CATEGORIES):
            warnings.append(
                f"{side} side has {len(side_counts)} troop counts in the OCR row; "
                f"keeping the leftmost {len(CATEGORIES)} values."
            )
            counts_by_side[side] = side_counts[: len(CATEGORIES)]
            side_counts = counts_by_side[side]
        if 0 < len(side_counts) < len(CATEGORIES):
            warnings.append(
                f"{side} side has {len(side_counts)} troop counts, mapped "
                f"left->right as [{_format_mapped_categories(side_counts)}]; "
                "verify mapping."
            )

    total_counts = sum(len(values) for values in counts_by_side.values())
    status = "ok" if total_counts == len(CATEGORIES) * 2 else "partial"
    return counts_by_side, warnings, status


def _extract_troop_counts(
    lines: list[Line],
    mid_x: float,
) -> tuple[dict[str, list[int]], list[str], str, int | None]:
    header_idx = next(
        (idx for idx, line in enumerate(lines) if _is_stat_bonuses_header(line["text"])),
        None,
    )
    if header_idx is None:
        first_stat_idx = next(
            (
                idx
                for idx, line in enumerate(lines)
                if _parse_stat_row_from_text(line["text"]) is not None
            ),
            None,
        )
        if first_stat_idx is None:
            return {"attacker": [], "defender": []}, [], "missing_header", None
        if first_stat_idx == 0:
            return (
                {"attacker": [], "defender": []},
                [],
                "missing_row",
                lines[first_stat_idx]["top"],
            )
        counts, warnings, status = _parse_troop_row(lines[first_stat_idx - 1], mid_x)
        return counts, warnings, status, lines[first_stat_idx]["top"]
    if header_idx == 0:
        return {"attacker": [], "defender": []}, [], "missing_row", lines[header_idx]["top"]
    counts, warnings, status = _parse_troop_row(lines[header_idx - 1], mid_x)
    return counts, warnings, status, lines[header_idx]["top"]


def _better_troop_candidate(
    current: tuple[dict[str, list[int]], list[str], str, int | None],
    candidate: tuple[dict[str, list[int]], list[str], str, int | None],
) -> tuple[dict[str, list[int]], list[str], str, int | None]:
    def rank(
        item: tuple[dict[str, list[int]], list[str], str, int | None]
    ) -> tuple[int, int, int, int]:
        counts, warnings, status, _header_top = item
        total = sum(len(values) for values in counts.values())
        total_value = sum(sum(values) for values in counts.values())
        status_rank = {
            "ok": 4,
            "partial": 3,
            "percentage": 2,
            "no_counts": 1,
            "missing_row": 0,
            "missing_header": -1,
        }.get(status, -2)
        return (total, status_rank, -len(warnings), total_value)

    return candidate if rank(candidate) > rank(current) else current


def _troop_band_retry_variants(
    img: Image.Image, header_top: int
) -> Iterable[tuple[str, Image.Image, str]]:
    band_bottom = min(img.height, max(header_top + 80, 80))
    band = img.crop((0, 0, img.width, band_bottom))
    yield ("troop_band", band, "--psm 6")
    yield ("troop_band_upscale2x", _upscale(band), "--psm 6")
    yield ("troop_band_autocontrast", _autocontrast(band), "--psm 6")
    yield ("troop_band_upscale2x_autocontrast", _autocontrast(_upscale(band)), "--psm 6")
    yield ("troop_band_binarize", _binarize(band), "--psm 6")
    yield ("troop_band_upscale2x_binarize", _binarize(_upscale(band), threshold=170), "--psm 6")


# ---------------------------------------------------------------------------
# Targeted row recovery
# ---------------------------------------------------------------------------


def _linear_fit(points: list[tuple[float, float]]) -> tuple[float, float] | None:
    """Return (slope, intercept) for y = slope*x + intercept, or None."""
    n = len(points)
    if n < 2:
        return None
    mean_x = sum(p[0] for p in points) / n
    mean_y = sum(p[1] for p in points) / n
    num = sum((p[0] - mean_x) * (p[1] - mean_y) for p in points)
    den = sum((p[0] - mean_x) ** 2 for p in points)
    if den == 0:
        return None
    slope = num / den
    intercept = mean_y - slope * mean_x
    return slope, intercept


def predict_missing_row_bands(
    found: dict[StatKey, float],
    missing: list[StatKey],
    img_height: int,
) -> list[tuple[StatKey, int, int]]:
    """Predict (key, band_top, band_bottom) for each missing stat row.

    Uses a linear fit of row_index -> center_y over the rows that *were*
    detected. The band height is derived from the fitted slope (pixels per
    row step), padded generously so a slightly-offset row is still inside.
    """
    if not missing or not found:
        return []
    idx_by_key = {key: i for i, key in enumerate(STAT_ROW_ORDER)}
    points = [(idx_by_key[k], y) for k, y in found.items()]
    fit = _linear_fit(points)
    if fit is None:
        return []
    slope, intercept = fit
    row_h = abs(slope)
    if row_h <= 1:
        return []
    pad = max(row_h * 0.8, 12.0)
    bands: list[tuple[StatKey, int, int]] = []
    for key in missing:
        ri = idx_by_key[key]
        center = slope * ri + intercept
        top = max(0, int(center - pad))
        bot = min(img_height, int(center + pad))
        if bot > top:
            bands.append((key, top, bot))
    return bands


def _targeted_row_recovery(
    img: Image.Image,
    found_center_y: dict[StatKey, float],
    missing: list[StatKey],
) -> dict[StatKey, StatPair]:
    """Try to recover missing rows by running OCR on a predicted band."""
    bands = predict_missing_row_bands(found_center_y, missing, img.height)
    if not bands:
        return {}

    recovered: dict[StatKey, StatPair] = {}
    for key, top, bot in bands:
        band = img.crop((0, top, img.width, bot))
        variants: list[tuple[Image.Image, str]] = [
            (band, "--psm 7"),
            (_upscale(band, 2), "--psm 7"),
            (_autocontrast(_upscale(band, 2)), "--psm 7"),
            (_binarize(_upscale(band, 2), threshold=170), "--psm 7"),
            (band, "--psm 6"),
            (_upscale(band, 3), "--psm 7"),
        ]
        for variant, cfg in variants:
            try:
                text = pytesseract.image_to_string(variant, config=cfg)
            except Exception:  # noqa: BLE001
                continue
            # The band may contain multiple lines; scan each.
            for line in text.splitlines():
                parsed = _parse_stat_row_from_text(line)
                if parsed is None:
                    continue
                p_key, pair = parsed
                if p_key == key and p_key not in recovered:
                    recovered[p_key] = pair
                    break
            if key in recovered:
                break
    return recovered


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def _shape_side(
    counts_by_side: dict[str, list[int]],
    stats: dict[StatKey, StatPair],
    side: str,
) -> dict[str, Any]:
    side_idx = 0 if side == "attacker" else 1
    counts = counts_by_side[side]
    troops: dict[str, int | None] = {}
    for i, cat in enumerate(CATEGORIES):
        troops[cat] = counts[i] if i < len(counts) else None
    stat_out: dict[str, dict[str, float | None]] = {
        cat: {stat: None for stat in STAT_NAMES} for cat in CATEGORIES
    }
    for (cat, stat), pair in stats.items():
        stat_out[cat][stat] = pair[side_idx]
    return {"troops": troops, "stats": stat_out}


def parse_report(image_bytes: bytes) -> dict[str, Any]:
    img = Image.open(io.BytesIO(image_bytes))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    # Primary pass.
    primary_lines, primary_text = _ocr_lines(img, "--psm 6")
    stats, center_y, parse_warnings = _parse_stats(primary_lines)
    troop_counts, troop_warnings, troop_status, troop_header_top = _extract_troop_counts(
        primary_lines,
        img.width / 2.0,
    )

    retried_full = False
    retried_troops = False

    def _needs_retry() -> bool:
        return any(k not in stats for k in STAT_ROW_ORDER)

    # Full-image preprocessing retries.
    if _needs_retry() or sum(len(values) for values in troop_counts.values()) < 6:
        for _name, variant_img, cfg in _full_image_retry_variants(img):
            retried_full = True
            if not _needs_retry() and sum(len(values) for values in troop_counts.values()) >= 6:
                break
            try:
                v_lines, _v_text = _ocr_lines(variant_img, cfg)
            except Exception:  # noqa: BLE001
                continue
            v_stats, _v_centers, _v_warnings = _parse_stats(v_lines)
            for k, pair in v_stats.items():
                if k not in stats:
                    stats[k] = pair
            if sum(len(values) for values in troop_counts.values()) < 6:
                candidate = _extract_troop_counts(v_lines, variant_img.width / 2.0)
                troop_counts, troop_warnings, troop_status, troop_header_top = (
                    _better_troop_candidate(
                        (troop_counts, troop_warnings, troop_status, troop_header_top),
                        candidate,
                    )
                )

    # Targeted crop retries for troop counts still missing.
    if sum(len(values) for values in troop_counts.values()) < 6 and troop_status != "percentage":
        header_top = troop_header_top or next(
            (
                line["top"]
                for line in primary_lines
                if _is_stat_bonuses_header(line["text"])
            ),
            None,
        )
        if header_top is not None:
            for _name, variant_img, cfg in _troop_band_retry_variants(img, header_top):
                retried_troops = True
                try:
                    v_lines, _v_text = _ocr_lines(variant_img, cfg)
                except Exception:  # noqa: BLE001
                    continue
                troop_counts, troop_warnings, troop_status, troop_header_top = (
                    _better_troop_candidate(
                        (troop_counts, troop_warnings, troop_status, troop_header_top),
                        _extract_troop_counts(v_lines, variant_img.width / 2.0),
                    )
                )
                if sum(len(values) for values in troop_counts.values()) >= 6:
                    break

    # Targeted band-crop retry for stat rows still missing.
    missing = [k for k in STAT_ROW_ORDER if k not in stats]
    if missing and center_y:
        recovered = _targeted_row_recovery(img, center_y, missing)
        for k, pair in recovered.items():
            stats.setdefault(k, pair)

    # Final warnings.
    warnings: list[str] = list(parse_warnings)
    warnings.extend(troop_warnings)
    missing = [k for k in STAT_ROW_ORDER if k not in stats]
    if missing:
        warnings.append(
            "missing stat rows: " + ", ".join(f"{c} {s}" for c, s in missing)
        )
    if troop_status in {"missing_header", "missing_row", "no_counts"}:
        warnings.append(
            "could not parse troop counts from the row above 'Stat Bonuses'; "
            "populate them manually or retry with a clearer crop"
        )

    return {
        "attacker": _shape_side(troop_counts, stats, "attacker"),
        "defender": _shape_side(troop_counts, stats, "defender"),
        "raw_text": primary_text,
        "warnings": warnings,
        "ocr_retried": retried_full or retried_troops,
    }


def main() -> int:
    raw = sys.stdin.buffer.read()
    if not raw:
        print(json.dumps({"error": "no image data on stdin"}))
        return 2
    try:
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
