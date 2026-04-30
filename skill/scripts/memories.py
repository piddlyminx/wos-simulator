"""Deterministic hidden-object click loop for WOS memories screens."""
from __future__ import annotations

import csv
import difflib
import json
import random
import subprocess
import time
from pathlib import Path

import cv2

from emulator import adb_screencap_bgr, adb_tap

LABEL_REGION = (20, 1112, 700, 1260)
ROW_COUNT = 2
COL_COUNT = 3
MATCH_THRESHOLD = 0.68
POST_TAP_DELAY_SEC = 0.03
POST_TAP_DELAY_MAX_SEC = 0.06
LOOP_DELAY_SEC = 0.03
MAX_RUNTIME_SEC = 45.0

_rapid_ocr = None


def _get_rapid():
    global _rapid_ocr
    if _rapid_ocr is None:
        from ocr import RapidOCR

        _rapid_ocr = RapidOCR()
    return _rapid_ocr


def _normalize_label(text: str) -> str:
    return "".join(ch for ch in text.lower() if ch.isalnum())


def _load_map(path: str | Path) -> dict[str, tuple[int, int]]:
    p = Path(path).expanduser()
    if not p.exists() and isinstance(path, str) and ":" in path:
        converted = subprocess.run(
            ["wslpath", "-u", path],
            capture_output=True,
            text=True,
        )
        candidate = Path(converted.stdout.strip()).expanduser()
        if converted.returncode == 0 and candidate.exists():
            p = candidate
    if not p.exists():
        raise FileNotFoundError(f"Memories map file not found: {p}")

    if p.suffix.lower() == ".json":
        data = json.loads(p.read_text())
        result: dict[str, tuple[int, int]] = {}
        if isinstance(data, dict):
            for label, value in data.items():
                if isinstance(value, dict):
                    x = int(value["x"])
                    y = int(value["y"])
                else:
                    x = int(value[0])
                    y = int(value[1])
                result[str(label)] = (x, y)
            return result
        raise ValueError("JSON map must be an object mapping label -> [x, y] or {x, y}")

    if p.suffix.lower() == ".csv":
        with p.open(newline="") as fh:
            reader = csv.DictReader(fh)
            columns = {name.lower(): name for name in (reader.fieldnames or [])}
            item_col = columns.get("item") or columns.get("label") or columns.get("name")
            x_col = columns.get("x")
            y_col = columns.get("y")
            if not item_col or not x_col or not y_col:
                raise ValueError("CSV map must include Item/label/name, x, and y columns")
            result: dict[str, tuple[int, int]] = {}
            for row in reader:
                label = (row.get(item_col) or "").strip()
                if not label:
                    continue
                result[label] = (int(row[x_col]), int(row[y_col]))
            return result

    raise ValueError(f"Unsupported map file type: {p.suffix or '<none>'}")


def _capture_strip_bgr(serial: str):
    img = adb_screencap_bgr(serial)
    x1, y1, x2, y2 = LABEL_REGION
    return img[y1:y2, x1:x2, :]


def _slot_bounds(index: int) -> tuple[int, int, int, int]:
    w = LABEL_REGION[2] - LABEL_REGION[0]
    h = LABEL_REGION[3] - LABEL_REGION[1]
    col = index % COL_COUNT
    row = index // COL_COUNT
    slot_w = w // COL_COUNT
    slot_h = h // ROW_COUNT
    sx1 = col * slot_w
    sy1 = row * slot_h
    sx2 = (col + 1) * slot_w if col < COL_COUNT - 1 else w
    sy2 = (row + 1) * slot_h if row < ROW_COUNT - 1 else h
    # Trim outer chrome and border, leaving the center label region.
    pad_x = 10
    pad_y = 6
    return (sx1 + pad_x, sy1 + pad_y, sx2 - pad_x, sy2 - pad_y)


def _ocr_text(crop_bgr) -> str:
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.normalize(gray, None, 0, 255, cv2.NORM_MINMAX)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    enlarged = cv2.resize(binary, None, fx=1.6, fy=1.6, interpolation=cv2.INTER_CUBIC)
    return enlarged


def _ocr_strip_items(strip_bgr) -> list[dict]:
    if strip_bgr.size == 0:
        return []

    enlarged = _ocr_text(strip_bgr)
    result = _get_rapid()(enlarged)
    if result and result[0]:
        items: list[dict] = []
        for box, text, _conf in result[0]:
            xs = [pt[0] for pt in box]
            ys = [pt[1] for pt in box]
            items.append({
                "text": " ".join(text.split()),
                "x": int(sum(xs) / len(xs) / 1.6),
                "y": int(sum(ys) / len(ys) / 1.6),
            })
        return items
    return []


def _visible_labels(strip_bgr) -> list[dict]:
    slot_texts: dict[int, list[tuple[int, str]]] = {}
    for item in _ocr_strip_items(strip_bgr):
        slot = None
        for idx in range(ROW_COUNT * COL_COUNT):
            sx1, sy1, sx2, sy2 = _slot_bounds(idx)
            if sx1 <= item["x"] <= sx2 and sy1 <= item["y"] <= sy2:
                slot = idx
                break
        if slot is None or not item["text"]:
            continue
        slot_texts.setdefault(slot, []).append((item["x"], item["text"]))

    visible: list[dict] = []
    for idx, parts in slot_texts.items():
        parts.sort(key=lambda item: item[0])
        text = " ".join(part for _, part in parts).strip()
        if not text:
            continue
        visible.append({
            "slot": idx,
            "text": text,
        })
    visible.sort(key=lambda item: item["slot"])
    return visible


def _best_match(text: str, labels: dict[str, tuple[int, int]]) -> tuple[str, tuple[int, int], float] | None:
    normalized = _normalize_label(text)
    if not normalized:
        return None

    best_label = ""
    best_coords = (0, 0)
    best_score = 0.0
    for label, coords in labels.items():
        candidate = _normalize_label(label)
        if not candidate:
            continue
        if normalized == candidate:
            return label, coords, 1.0
        score = difflib.SequenceMatcher(None, normalized, candidate).ratio()
        if normalized in candidate or candidate in normalized:
            score = max(score, 0.9)
        if score > best_score:
            best_label = label
            best_coords = coords
            best_score = score

    if best_score < MATCH_THRESHOLD:
        return None
    return best_label, best_coords, best_score


def run_memories(serial: str, map_path: str | Path) -> dict:
    labels = _load_map(map_path)
    clicked: list[dict] = []
    used_labels: set[str] = set()
    started_at = time.monotonic()

    while True:
        if time.monotonic() - started_at >= MAX_RUNTIME_SEC:
            return {
                "status": "timeout",
                "clicked": clicked,
                "total_clicked": len(clicked),
                "elapsed_sec": round(time.monotonic() - started_at, 3),
            }

        strip = _capture_strip_bgr(serial)
        visible = _visible_labels(strip)

        if not visible:
            time.sleep(LOOP_DELAY_SEC)
            continue

        batch: list[dict] = []
        for item in visible:
            match = _best_match(item["text"], labels)
            if match is None:
                continue
            label, coords, score = match
            if label in used_labels:
                continue
            batch.append({
                "seen_text": item["text"],
                "matched_label": label,
                "coords": coords,
                "score": round(score, 3),
            })

        if not batch:
            time.sleep(LOOP_DELAY_SEC)
            continue

        for chosen in batch:
            x, y = chosen["coords"]
            adb_tap(serial, x, y)
            clicked.append(chosen)
            used_labels.add(chosen["matched_label"])
            time.sleep(random.uniform(POST_TAP_DELAY_SEC, POST_TAP_DELAY_MAX_SEC))
