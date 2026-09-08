"""Read one hero's Expedition descriptions without upgrading any skill."""

from __future__ import annotations

import hashlib
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import cv2

import capture_hero_skills as levels


PANEL_CROP = (25, 730, 670, 335)


def canonical_hero_name(value: str) -> str:
    names = levels._load_hero_names()
    matches = [name for name in names if name.casefold() == value.strip().casefold()]
    if len(matches) != 1:
        raise ValueError(f"Unknown hero {value!r}; use a canonical name from data/hero_names.txt")
    return matches[0]


def _write_image(path: Path, image) -> dict:
    if not cv2.imwrite(str(path), image):
        raise RuntimeError(f"Could not save screenshot {path}")
    return {"path": str(path.resolve()), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def _read_panel(image) -> dict:
    from ocr import RapidOCR

    x, y, width, height = PANEL_CROP
    result = RapidOCR()(levels._crop(image, x, y, width, height))
    lines = []
    for box, text, confidence in (result[0] if result and result[0] else []):
        points = [[float(px) + x, float(py) + y] for px, py in box]
        lines.append({"text": str(text), "confidence": float(confidence), "box": points})
    def vertical_center(line):
        return sum(point[1] for point in line["box"]) / len(line["box"])

    def height(line):
        return max(point[1] for point in line["box"]) - min(point[1] for point in line["box"])

    lines.sort(key=vertical_center)
    rows = []
    for line in lines:
        if rows and abs(vertical_center(line) - vertical_center(rows[-1][0])) <= max(6, min(height(line), height(rows[-1][0])) * 0.55):
            rows[-1].append(line)
        else:
            rows.append([line])
    for row in rows:
        row.sort(key=lambda line: min(point[0] for point in line["box"]))
    texts = [" ".join(line["text"].strip() for line in row) for row in rows]
    title_index = next((i for i, text in enumerate(texts) if re.search(r"\bLv\.?\s*\d+", text, re.I)), None)
    preview_index = next((i for i, text in enumerate(texts) if "upgrade preview" in text.casefold()), None)
    title = texts[title_index] if title_index is not None else None
    level_match = re.search(r"\bLv\.?\s*(\d+)", title, re.I) if title else None
    description_start = title_index + 1 if title_index is not None else 0
    description_end = preview_index if preview_index is not None else len(texts)
    return {
        "title": title,
        "displayed_level": int(level_match.group(1)) if level_match else None,
        "description_text": "\n".join(texts[description_start:description_end]) or None,
        "upgrade_preview_status": "visible_in_ocr" if preview_index is not None else "not_detected_in_viewport",
        "upgrade_preview_text": ("\n".join(texts[preview_index + 1:]) or None) if preview_index is not None else None,
        "raw_lines": lines,
        "text_lines": texts,
        "interpretation": "Unreviewed OCR; full screenshots are the primary capture artifacts.",
    }


def capture_hero_skill_details(emulator, instance_name: str, hero_name: str, output_dir: str, *, debug: bool = False) -> dict:
    hero_name = canonical_hero_name(hero_name)
    out = Path(output_dir).resolve()
    if out.exists() and any(out.iterdir()):
        raise ValueError(f"Preserve existing captures: output directory is not empty: {out}")
    out.mkdir(parents=True, exist_ok=True)
    data = levels.capture_hero_skills(
        emulator,
        instance_name,
        debug_dir=str(out / "navigation") if debug else None,
        target_hero=hero_name,
    )
    current_levels = data[hero_name]
    known_names = levels._load_hero_names()
    overview = emulator.screencap_bgr()
    if levels._read_hero_frame(overview, known_names) != (hero_name, current_levels):
        _write_image(out / "unexpected-hero.png", overview)
        raise RuntimeError("Hero identity or skill levels changed before skill details capture")
    slots = [("skill_1", levels.SLOT_1_CROP)]
    slots += [("skill_2", levels.SLOT_2_CROP), ("skill_3", levels.SLOT_3_CROP)] if "skill_3" in current_levels else [("skill_2", levels.SLOT_3_CROP)]
    manifest = {
        "schema_version": 1,
        "capture_kind": "hero_expedition_skill_details",
        "captured_at_utc": datetime.now(timezone.utc).isoformat(),
        "instance_name": instance_name,
        "hero": hero_name,
        "current_skill_levels": current_levels,
        "overview": _write_image(out / "hero-skills.png", overview),
        "skills": [],
        "complete": False,
        "notes": [
            "Selected only Expedition skill icons; Upgrade buttons are never tapped.",
            "Current levels are read from the hero screen, not inferred from upgrade-preview values.",
            "Missing preview OCR does not establish that a preview is unavailable; inspect the full image.",
            "This command does not update player_hero_skills.json or create battle observations.",
        ],
    }
    manifest_path = out / "skill-details.json"

    def save_manifest():
        manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

    save_manifest()
    seen_titles = set()
    for slot, (x, y, width, height) in slots:
        point = (x + width // 2, y + height // 2)
        emulator.tap(*point)
        time.sleep(0.35)
        deadline = time.monotonic() + 2.5
        while True:
            image = emulator.screencap_bgr()
            parsed = levels._read_hero_frame(image, known_names)
            if parsed is not None and parsed != (hero_name, current_levels):
                _write_image(out / f"{slot}-unexpected-state.png", image)
                raise RuntimeError("Hero identity or current levels changed; refusing further taps")
            panel = _read_panel(image) if parsed is not None else None
            if panel and panel["title"] and panel["title"] not in seen_titles:
                break
            if time.monotonic() >= deadline:
                if parsed is None or (panel and panel["title"] in seen_titles):
                    _write_image(out / f"{slot}-unconfirmed-selection.png", image)
                    raise RuntimeError(f"Could not confirm a distinct {slot} description in the skill details pane; refusing further taps")
                break
            time.sleep(0.1)
        assert panel is not None
        selected_level = panel["displayed_level"]
        if current_levels[slot] > 0 and selected_level is not None and selected_level != current_levels[slot]:
            _write_image(out / f"{slot}-unexpected-level.png", image)
            raise RuntimeError(f"{slot} skill details level differs from its current icon level")
        if panel["title"]:
            seen_titles.add(panel["title"])
        row = {
            "slot": slot,
            "current_level": current_levels[slot],
            "locked": current_levels[slot] == 0,
            "selected_icon_center": list(point),
            "screenshot": _write_image(out / f"{slot}.png", image),
            "panel_crop": _write_image(out / f"{slot}-panel.png", levels._crop(image, *PANEL_CROP)),
            "ocr": panel,
            "needs_manual_review": True,
        }
        manifest["skills"].append(row)
        save_manifest()
    manifest["complete"] = True
    manifest["finished_at_utc"] = datetime.now(timezone.utc).isoformat()
    save_manifest()
    return {"hero": hero_name, "current_skill_levels": current_levels, "skills_captured": len(slots), "output_dir": str(out), "manifest": str(manifest_path), "complete": True}
