#!/usr/bin/env python3
"""Extract hero names from Battle Details screenshots.

Takes 2 screenshots: BD top (unscrolled) and BD bottom (scrolled).
Returns list of hero pairs: [{left_hero, right_hero}, ...]
Left is always the report owner's side, right is opponent's side.

Uses a whitelist of known hero names (data/hero_names.txt) to filter OCR noise.
"""
import sys, json
from pathlib import Path
import cv2
import numpy as np

_rapid = None
_sharpen_kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]], dtype=np.float32)

# ── Hero name whitelist ────────────────────────────────────────────────────────
_HERO_NAMES_FILE = Path(__file__).parent.parent / "data" / "hero_names.txt"
_HERO_NAMES: set[str] = set()
_HERO_NAMES_LOWER: dict[str, str] = {}  # lowercase -> canonical


def _load_hero_names():
    global _HERO_NAMES, _HERO_NAMES_LOWER
    if _HERO_NAMES:
        return
    with open(_HERO_NAMES_FILE) as f:
        for line in f:
            name = line.strip()
            if name:
                _HERO_NAMES.add(name)
                _HERO_NAMES_LOWER[name.lower()] = name


def _match_hero_name(text: str) -> str | None:
    """Match OCR text against known hero names. Returns canonical name or None."""
    _load_hero_names()
    t = text.strip()

    # Exact match (case-insensitive)
    if t.lower() in _HERO_NAMES_LOWER:
        return _HERO_NAMES_LOWER[t.lower()]

    # Fuzzy: check if any hero name is contained in the text
    for lower, canonical in _HERO_NAMES_LOWER.items():
        if lower in t.lower() and len(lower) >= 3:
            return canonical

    return None


def _get_rapid():
    global _rapid
    if _rapid is None:
        from ocr import RapidOCR

        _rapid = RapidOCR()
    return _rapid


def _ocr_region(img, x_offset: int = 0, y_offset: int = 0, debug_path: Path | None = None) -> list:
    """Run RapidOCR on an image region with sharpening. Offsets are added to x/y."""
    sharpened = cv2.filter2D(img, -1, _sharpen_kernel)
    if debug_path is not None:
        debug_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(debug_path), sharpened)
    result = _get_rapid()(sharpened)
    if not result or not result[0]:
        return []
    items = []
    for box, text, conf in result[0]:
        ys = [pt[1] for pt in box]
        xs = [pt[0] for pt in box]
        items.append({
            "text": text,
            "y": int(np.mean(ys)) + y_offset,
            "x": int(np.mean(xs)) + x_offset,
        })
    return items


def _ocr_full(img, debug_dir: Path | None = None, label: str = ""):
    """Run RapidOCR on left and right halves separately, then merge.

    Splitting avoids cross-column text-box interference where the attacker name
    on the left and the defender label on the right (same y) cause RapidOCR to
    skip one of them on the full-image pass.
    """
    h, w = img.shape[:2]
    mid = w // 2
    left_debug = debug_dir / f"{label}_left_ocr_input.png" if debug_dir is not None else None
    right_debug = debug_dir / f"{label}_right_ocr_input.png" if debug_dir is not None else None
    left_items  = _ocr_region(img[:, :mid],  x_offset=0, debug_path=left_debug)
    right_items = _ocr_region(img[:, mid:],  x_offset=mid, debug_path=right_debug)
    return left_items + right_items


def _extract_heroes_from_image(img, debug_dir: Path | None = None, label: str = ""):
    """Extract hero names from a single BD screenshot using whitelist matching."""
    raw_items = _ocr_full(img, debug_dir=debug_dir, label=label)
    if not raw_items:
        return []

    # Match each OCR item against hero whitelist
    candidates = []
    for it in raw_items:
        # Check for "Vacant"
        if "vacant" in it["text"].lower():
            candidates.append({"name": "Vacant", "y": it["y"], "x": it["x"]})
            continue

        matched = _match_hero_name(it["text"])
        if matched:
            candidates.append({"name": matched, "y": it["y"], "x": it["x"]})

    # Pair by similar y-coordinate
    candidates.sort(key=lambda c: c["y"])
    pairs = []
    used = set()

    for i, c1 in enumerate(candidates):
        if i in used:
            continue
        best_j = None
        for j, c2 in enumerate(candidates):
            if j <= i or j in used:
                continue
            if abs(c1["y"] - c2["y"]) < 40:
                best_j = j
                break

        if best_j is not None:
            c2 = candidates[best_j]
            left = c1 if c1["x"] < c2["x"] else c2
            right = c2 if c1["x"] < c2["x"] else c1
            pairs.append({
                "left_hero": left["name"],
                "right_hero": right["name"],
            })
            used.add(i)
            used.add(best_j)
        else:
            # Unpaired — solo hero visible
            side = "left_hero" if c1["x"] < 360 else "right_hero"
            pairs.append({side: c1["name"]})
            used.add(i)

    return pairs


def parse_battle_details(bd_top_path, bd_bottom_path, debug_outdir: str | None = None):
    """Parse two Battle Details screenshots. Returns list of hero pairs."""
    img_top = cv2.imread(str(bd_top_path))
    img_bot = cv2.imread(str(bd_bottom_path))

    if img_top is None:
        raise FileNotFoundError(f"Cannot read {bd_top_path}")
    if img_bot is None:
        raise FileNotFoundError(f"Cannot read {bd_bottom_path}")

    debug_dir = Path(debug_outdir) if debug_outdir else None
    all_pairs = []
    for label, img in [("bd_top", img_top), ("bd_bot", img_bot)]:
        all_pairs.extend(_extract_heroes_from_image(img, debug_dir=debug_dir, label=label))

    # Deduplicate: each hero name appears at most once per side
    seen_left = set()
    seen_right = set()
    unique = []
    for pair in all_pairs:
        lh = pair.get("left_hero", "")
        rh = pair.get("right_hero", "")
        if lh and lh in seen_left:
            lh = ""
        if rh and rh in seen_right:
            rh = ""
        if not lh and not rh:
            continue
        if lh:
            seen_left.add(lh)
        if rh:
            seen_right.add(rh)
        entry = {}
        if lh:
            entry["left_hero"] = lh
        if rh:
            entry["right_hero"] = rh
        unique.append(entry)

    result = {"hero_pairs": unique}
    if debug_dir is not None:
        debug_dir.mkdir(parents=True, exist_ok=True)
        (debug_dir / "battle_details_parser_debug.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <bd_top.png> <bd_bottom.png>")
        sys.exit(1)
    data = parse_battle_details(sys.argv[1], sys.argv[2])
    print(json.dumps(data, indent=2))
