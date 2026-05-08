"""Deterministic hidden-object click loop for WOS memories screens."""
from __future__ import annotations

import csv
import difflib
import json
import queue
import random
import subprocess
import threading
import time
import tempfile
from datetime import datetime
from pathlib import Path

import cv2

from emulator import adb_screencap_bgr, adb_tap

LABEL_REGION = (20, 1112, 700, 1260)
TEAM_ROOM_START_REGION = (360, 840, 690, 940)
TEAM_ROOM_START_TAP = (520, 895)
SOLO_START_REGION = (320, 1125, 655, 1245)
SOLO_START_TAP = (490, 1192)
START_BUTTON_MASK_RATIO = 0.12
TEAM_ROOM_START_RETRY_SEC = 1.0
ROW_COUNT = 2
COL_COUNT = 3
MATCH_THRESHOLD = 0.68
MIN_MATCH_CHARS = 2
POST_TAP_DELAY_SEC = 0.03
POST_TAP_DELAY_MAX_SEC = 0.06
LOOP_DELAY_SEC = 0.1
MAX_RUNTIME_SEC = 60.0
TARGET_CLICK_COUNT = 26
VISIBLE_RETRY_DELAY_SEC = 0.8
MAX_TAP_ATTEMPTS_PER_LABEL = 3
DIAGNOSTICS_ROOT = Path(__file__).resolve().parents[1] / "tmp" / "memories"
OCR_SCALE = 1.6
TESSERACT_PSM = "11"
TAP_MODES = {"threaded", "inline"}

_rapid_ocr = None


def _tap_chosen(
    serial: str,
    chosen: dict,
    clicked: list[dict],
    timing: dict[str, float],
    started_at: float,
) -> None:
    before_tap = time.monotonic()
    x, y = chosen["coords"]
    adb_tap(serial, x, y)
    elapsed = time.monotonic() - before_tap
    chosen["tapped_at_sec"] = round(time.monotonic() - started_at, 3)
    clicked.append(chosen)
    timing["tap_sec"] += elapsed


class _TapWorker:
    def __init__(
        self,
        serial: str,
        clicked: list[dict],
        timing: dict[str, float],
        started_at: float,
    ) -> None:
        self._serial = serial
        self._clicked = clicked
        self._timing = timing
        self._started_at = started_at
        self._queue: queue.Queue[dict | None] = queue.Queue()
        self._lock = threading.Lock()
        self._pending_lock = threading.Lock()
        self._pending_labels: set[str] = set()
        self._error: Exception | None = None
        self._thread = threading.Thread(target=self._run, name="memories-tap-worker", daemon=True)
        self._thread.start()

    def submit(self, chosen: dict) -> None:
        with self._pending_lock:
            self._pending_labels.add(chosen["matched_label"])
        self._queue.put(chosen)

    def is_pending(self, label: str) -> bool:
        with self._pending_lock:
            return label in self._pending_labels

    def close(self) -> None:
        self._queue.join()
        self._queue.put(None)
        self._queue.join()
        self._thread.join()
        if self._error is not None:
            raise self._error

    def _run(self) -> None:
        while True:
            chosen = self._queue.get()
            try:
                if chosen is None:
                    return
                with self._lock:
                    _tap_chosen(
                        self._serial,
                        chosen,
                        self._clicked,
                        self._timing,
                        self._started_at,
                    )
                time.sleep(random.uniform(POST_TAP_DELAY_SEC, POST_TAP_DELAY_MAX_SEC))
            except Exception as exc:
                self._error = exc
            finally:
                if chosen is not None:
                    with self._pending_lock:
                        self._pending_labels.discard(chosen["matched_label"])
                self._queue.task_done()


def _get_rapid():
    global _rapid_ocr
    if _rapid_ocr is None:
        from rapidocr import EngineType, LangDet, LangRec, ModelType, OCRVersion

        from ocr import RapidOCR

        _rapid_ocr = RapidOCR(
            use_angle_cls=False,
            params={
                "Global.use_cls": False,
                "Det.engine_type": EngineType.ONNXRUNTIME,
                "Det.lang_type": LangDet.CH,
                "Det.model_type": ModelType.MOBILE,
                "Det.ocr_version": OCRVersion.PPOCRV5,
                "Det.use_dilation": True,
                "Rec.engine_type": EngineType.ONNXRUNTIME,
                "Rec.lang_type": LangRec.EN,
                "Rec.model_type": ModelType.MOBILE,
                "Rec.ocr_version": OCRVersion.PPOCRV5,
            },
        )
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


def _capture_screen_bgr(serial: str):
    return adb_screencap_bgr(serial)


def _crop_label_strip_bgr(img):
    x1, y1, x2, y2 = LABEL_REGION
    return img[y1:y2, x1:x2, :]


def _capture_strip_bgr(serial: str):
    img = adb_screencap_bgr(serial)
    return _crop_label_strip_bgr(img)


def _team_room_start_visible(screen_bgr) -> bool:
    x1, y1, x2, y2 = TEAM_ROOM_START_REGION
    return _purple_start_region_visible(screen_bgr, (x1, y1, x2, y2))


def _solo_start_visible(screen_bgr) -> bool:
    x1, y1, x2, y2 = SOLO_START_REGION
    return _purple_start_region_visible(screen_bgr, (x1, y1, x2, y2))


def _purple_start_region_visible(screen_bgr, region_bounds: tuple[int, int, int, int]) -> bool:
    x1, y1, x2, y2 = region_bounds
    region = screen_bgr[y1:y2, x1:x2, :]
    if region.size == 0:
        return False
    blue, green, red = cv2.split(region)
    start_pixels = (red > 180) & (blue > 170) & (green < 180)
    return float(start_pixels.mean()) >= START_BUTTON_MASK_RATIO


def _visible_start_tap(screen_bgr) -> tuple[int, int] | None:
    if _team_room_start_visible(screen_bgr):
        return TEAM_ROOM_START_TAP
    if _solo_start_visible(screen_bgr):
        return SOLO_START_TAP
    return None


def _tap_start(serial: str, coords: tuple[int, int]) -> None:
    adb_tap(serial, *coords)


def _adb_tap_batch(serial: str, coords: list[tuple[int, int]]) -> None:
    if not coords:
        return
    script = "; ".join(f"input tap {int(x)} {int(y)}" for x, y in coords)
    result = subprocess.run(
        ["adb", "-s", serial, "shell", script],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        for x, y in coords:
            adb_tap(serial, x, y)


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
    red = crop_bgr[:, :, 2]
    binary = cv2.threshold(red, 160, 255, cv2.THRESH_BINARY_INV)[1]
    enlarged = cv2.resize(binary, None, fx=OCR_SCALE, fy=OCR_SCALE, interpolation=cv2.INTER_CUBIC)
    return enlarged


def _ocr_items_from_tesseract_tsv(tsv: str) -> list[dict]:
    items: list[dict] = []
    lines = [line for line in tsv.splitlines() if line.strip()]
    if not lines:
        return items

    columns = lines[0].split("\t")
    try:
        level_i = columns.index("level")
        left_i = columns.index("left")
        top_i = columns.index("top")
        width_i = columns.index("width")
        height_i = columns.index("height")
        conf_i = columns.index("conf")
        text_i = columns.index("text")
    except ValueError:
        return items

    for line in lines[1:]:
        parts = line.split("\t")
        if len(parts) <= text_i:
            continue
        text = " ".join(parts[text_i].split())
        if not text or parts[level_i] != "5":
            continue
        try:
            left = int(parts[left_i])
            top = int(parts[top_i])
            width = int(parts[width_i])
            height = int(parts[height_i])
            conf = float(parts[conf_i])
        except ValueError:
            continue
        items.append({
            "text": text,
            "x": int((left + width / 2) / OCR_SCALE),
            "y": int((top + height / 2) / OCR_SCALE),
            "conf": round(conf, 3),
        })
    return items


def _tesseract_ocr_items(processed) -> list[dict]:
    with tempfile.NamedTemporaryFile(suffix=".png") as fh:
        if not cv2.imwrite(fh.name, processed):
            raise RuntimeError("failed to write temporary OCR image")
        result = subprocess.run(
            ["tesseract", fh.name, "stdout", "--psm", TESSERACT_PSM, "-l", "eng", "tsv"],
            capture_output=True,
            text=True,
        )
    if result.returncode != 0:
        raise RuntimeError(f"tesseract failed: {result.stderr.strip()}")
    return _ocr_items_from_tesseract_tsv(result.stdout)


def _ocr_strip_items(strip_bgr) -> list[dict]:
    if strip_bgr.size == 0:
        return []

    enlarged = _ocr_text(strip_bgr)
    return _tesseract_ocr_items(enlarged)


def _visible_labels_from_items(items: list[dict]) -> list[dict]:
    slot_texts: dict[int, list[tuple[int, str]]] = {}
    for item in items:
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


def _visible_labels(strip_bgr) -> list[dict]:
    return _visible_labels_from_items(_ocr_strip_items(strip_bgr))


def _new_diagnostics_dir() -> Path:
    DIAGNOSTICS_ROOT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    output_dir = DIAGNOSTICS_ROOT / stamp
    suffix = 1
    while output_dir.exists():
        output_dir = DIAGNOSTICS_ROOT / f"{stamp}-{suffix}"
        suffix += 1
    output_dir.mkdir()
    return output_dir


def _buffer_loop_diagnostics(
    loop: int,
    screen_bgr,
    strip_bgr,
    raw_ocr_items: list[dict],
    visible_labels: list[dict],
    matches: list[dict],
) -> dict:
    return {
        "loop": loop,
        "screen_bgr": screen_bgr.copy(),
        "strip_bgr": strip_bgr.copy(),
        "label_region": {
            "x1": LABEL_REGION[0],
            "y1": LABEL_REGION[1],
            "x2": LABEL_REGION[2],
            "y2": LABEL_REGION[3],
        },
        "raw_ocr_items": raw_ocr_items,
        "slot_labels": visible_labels,
        "visible_labels": visible_labels,
        "matches": matches,
    }


def _flush_diagnostics(output_dir: Path, buffered: list[dict]) -> list[dict]:
    diagnostics: list[dict] = []
    for entry in buffered:
        loop = entry["loop"]
        stem = f"loop_{loop:03d}"
        screen_path = output_dir / f"{stem}_screen.png"
        strip_path = output_dir / f"{stem}_labels.png"
        labels_path = output_dir / f"{stem}_labels.json"

        cv2.imwrite(str(screen_path), entry["screen_bgr"])
        cv2.imwrite(str(strip_path), entry["strip_bgr"])
        payload = {
            key: value
            for key, value in entry.items()
            if key not in {"screen_bgr", "strip_bgr"}
        }
        payload["screen"] = screen_path.name
        payload["label_strip"] = strip_path.name
        labels_path.write_text(json.dumps(payload, indent=2) + "\n")
        diagnostics.append({
            "loop": loop,
            "screen": str(screen_path),
            "label_strip": str(strip_path),
            "labels": str(labels_path),
        })
    return diagnostics


def _prepare_label_index(labels: dict[str, tuple[int, int]]) -> list[tuple[str, str, tuple[int, int]]]:
    return [
        (label, normalized, coords)
        for label, coords in labels.items()
        if (normalized := _normalize_label(label))
    ]


def _best_match(
    text: str,
    labels: dict[str, tuple[int, int]] | list[tuple[str, str, tuple[int, int]]],
) -> tuple[str, tuple[int, int], float] | None:
    normalized = _normalize_label(text)
    label_index = _prepare_label_index(labels) if isinstance(labels, dict) else labels
    if len(normalized) < MIN_MATCH_CHARS:
        for label, candidate, coords in label_index:
            if normalized and normalized == candidate:
                return label, coords, 1.0
        return None

    best_label = ""
    best_coords = (0, 0)
    best_score = 0.0
    for label, candidate, coords in label_index:
        if normalized == candidate:
            return label, coords, 1.0
        score = difflib.SequenceMatcher(None, normalized, candidate).ratio()
        if (
            len(candidate) >= MIN_MATCH_CHARS
            and (normalized in candidate or candidate in normalized)
        ):
            score = max(score, 0.9)
        if score > best_score:
            best_label = label
            best_coords = coords
            best_score = score

    if best_score < MATCH_THRESHOLD:
        return None
    return best_label, best_coords, best_score


def _visible_known_labels(
    visible: list[dict],
    label_index: list[tuple[str, str, tuple[int, int]]],
) -> set[str]:
    labels: set[str] = set()
    for item in visible:
        match = _best_match(item["text"], label_index)
        if match is not None:
            labels.add(match[0])
    return labels


def run_memories(serial: str, map_path: str | Path, tap_mode: str = "threaded") -> dict:
    if tap_mode not in TAP_MODES:
        raise ValueError(f"tap_mode must be one of {sorted(TAP_MODES)}")

    labels = _load_map(map_path)
    label_index = _prepare_label_index(labels)
    clicked: list[dict] = []
    buffered_diagnostics: list[dict] = []
    used_labels: set[str] = set()
    tap_attempts: dict[str, int] = {}
    last_tap_at: dict[str, float] = {}
    started_at = time.monotonic()
    timing = {
        "loops": 0,
        "capture_sec": 0.0,
        "ocr_sec": 0.0,
        "match_sec": 0.0,
        "tap_sec": 0.0,
    }
    tap_worker = _TapWorker(serial, clicked, timing, started_at) if tap_mode == "threaded" else None
    last_start_tap_at = 0.0
    first_match_batch_tapped = False

    while True:
        if time.monotonic() - started_at >= MAX_RUNTIME_SEC:
            if tap_worker is not None:
                tap_worker.close()
            status = "timeout"
            output_dir = _new_diagnostics_dir()
            diagnostics = _flush_diagnostics(output_dir, buffered_diagnostics)
            payload = {
                "status": status,
                "output_dir": str(output_dir),
                "diagnostics": diagnostics,
                "clicked": clicked,
                "total_clicked": len(clicked),
                "total_unique_clicked": len(used_labels),
                "tap_mode": tap_mode,
                "elapsed_sec": round(time.monotonic() - started_at, 3),
                "timing": {
                    key: round(value, 3) if isinstance(value, float) else value
                    for key, value in timing.items()
                },
            }
            (output_dir / "summary.json").write_text(json.dumps(payload, indent=2) + "\n")
            return payload

        timing["loops"] += 1
        before_capture = time.monotonic()
        screen = _capture_screen_bgr(serial)
        strip = _crop_label_strip_bgr(screen)
        timing["capture_sec"] += time.monotonic() - before_capture

        before_ocr = time.monotonic()
        raw_ocr_items = _ocr_strip_items(strip)
        visible = _visible_labels_from_items(raw_ocr_items)
        visible_known_labels = _visible_known_labels(visible, label_index)
        timing["ocr_sec"] += time.monotonic() - before_ocr

        if not visible_known_labels and len(used_labels) >= TARGET_CLICK_COUNT:
            buffered_diagnostics.append(
                _buffer_loop_diagnostics(timing["loops"], screen, strip, raw_ocr_items, visible, [])
            )
            if tap_worker is not None:
                tap_worker.close()
            output_dir = _new_diagnostics_dir()
            diagnostics = _flush_diagnostics(output_dir, buffered_diagnostics)
            payload = {
                "status": "complete",
                "output_dir": str(output_dir),
                "diagnostics": diagnostics,
                "clicked": clicked,
                "total_clicked": len(clicked),
                "total_unique_clicked": len(used_labels),
                "tap_mode": tap_mode,
                "elapsed_sec": round(time.monotonic() - started_at, 3),
                "timing": {
                    key: round(value, 3) if isinstance(value, float) else value
                    for key, value in timing.items()
                },
            }
            (output_dir / "summary.json").write_text(json.dumps(payload, indent=2) + "\n")
            return payload

        now = time.monotonic()
        start_tap = _visible_start_tap(screen)
        if (
            not visible_known_labels
            and len(used_labels) < TARGET_CLICK_COUNT
            and start_tap is not None
            and now - last_start_tap_at >= TEAM_ROOM_START_RETRY_SEC
        ):
            before_tap = time.monotonic()
            _tap_start(serial, start_tap)
            timing["tap_sec"] += time.monotonic() - before_tap
            last_start_tap_at = now
            buffered_diagnostics.append(
                _buffer_loop_diagnostics(timing["loops"], screen, strip, raw_ocr_items, visible, [])
            )
            time.sleep(LOOP_DELAY_SEC)
            continue

        if not visible:
            if len(used_labels) >= TARGET_CLICK_COUNT:
                if tap_worker is not None:
                    tap_worker.close()
                output_dir = _new_diagnostics_dir()
                diagnostics = _flush_diagnostics(output_dir, buffered_diagnostics)
                payload = {
                    "status": "complete",
                    "output_dir": str(output_dir),
                    "diagnostics": diagnostics,
                    "clicked": clicked,
                    "total_clicked": len(clicked),
                    "total_unique_clicked": len(used_labels),
                    "tap_mode": tap_mode,
                    "elapsed_sec": round(time.monotonic() - started_at, 3),
                    "timing": {
                        key: round(value, 3) if isinstance(value, float) else value
                        for key, value in timing.items()
                    },
                }
                (output_dir / "summary.json").write_text(json.dumps(payload, indent=2) + "\n")
                return payload

            buffered_diagnostics.append(
                _buffer_loop_diagnostics(timing["loops"], screen, strip, raw_ocr_items, visible, [])
            )
            time.sleep(LOOP_DELAY_SEC)
            continue

        before_match = time.monotonic()
        batch: list[dict] = []
        batch_labels: set[str] = set()
        for item in visible:
            match = _best_match(item["text"], label_index)
            if match is None:
                continue
            label, coords, score = match
            if label in batch_labels:
                continue
            if tap_worker is not None and tap_worker.is_pending(label):
                continue
            attempts = tap_attempts.get(label, 0)
            retry = label in used_labels
            if retry:
                if attempts >= MAX_TAP_ATTEMPTS_PER_LABEL:
                    continue
                if now - last_tap_at.get(label, 0.0) < VISIBLE_RETRY_DELAY_SEC:
                    continue
            batch_labels.add(label)
            batch.append({
                "seen_text": item["text"],
                "matched_label": label,
                "coords": coords,
                "score": round(score, 3),
                "retry": retry,
                "attempt": attempts + 1,
            })
        timing["match_sec"] += time.monotonic() - before_match

        if not batch:
            buffered_diagnostics.append(
                _buffer_loop_diagnostics(timing["loops"], screen, strip, raw_ocr_items, visible, batch)
            )
            time.sleep(LOOP_DELAY_SEC)
            continue

        if tap_mode == "inline" or not first_match_batch_tapped:
            for chosen in batch:
                label = chosen["matched_label"]
                used_labels.add(label)
                tap_attempts[label] = tap_attempts.get(label, 0) + 1
                _tap_chosen(serial, chosen, clicked, timing, started_at)
                last_tap_at[label] = time.monotonic()
                time.sleep(random.uniform(POST_TAP_DELAY_SEC, POST_TAP_DELAY_MAX_SEC))
            first_match_batch_tapped = True
        else:
            assert tap_worker is not None
            for chosen in batch:
                label = chosen["matched_label"]
                used_labels.add(label)
                tap_attempts[label] = tap_attempts.get(label, 0) + 1
                last_tap_at[label] = time.monotonic()
                chosen["queued_at_sec"] = round(time.monotonic() - started_at, 3)
                tap_worker.submit(chosen)

        buffered_diagnostics.append(
            _buffer_loop_diagnostics(timing["loops"], screen, strip, raw_ocr_items, visible, batch)
        )
