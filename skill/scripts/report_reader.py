"""High-level battle report reading flow for WOS inbox tabs."""
from __future__ import annotations

import difflib
import json
import logging
import os
import re
import tempfile
import time
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path

from capture_report_top_bottom import ReportBottomNotReachedError, capture_full_report
from navigation import (
    WosNavigationError,
    find_template,
    goto_city,
    goto_world_map,
)

_rapid_ocr = None
_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
_CAPTURED_REPORTS_DIR = Path(__file__).resolve().parent.parent / "captures" / "reports"
_SAVED_REPORT_IMAGE_STEMS = (
    "report_top",
    "report_bottom",
    "report_stats",
    "bd_top",
    "bd_bot",
)
_SAVED_REPORT_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
TEMPLATE_MAIL_ICON = str(_TEMPLATES_DIR / "tpl_mail_icon.png")
TEMPLATE_BATTLE_OVERVIEW = str(_TEMPLATES_DIR / "tpl_battle_overview.png")
TEMPLATE_REPORT_NEXT_BUTTON = str(_TEMPLATES_DIR / "report_next_button.png")

_REPORT_ENTRY_Y = {
    1: 220,
    2: 340,
    3: 510,
    4: 680,
    5: 880,
}
_REPORT_ENTRY_X = 360
_REPORT_NEXT_BUTTON_REGION = (620, 560, 720, 720)
_REPORT_NEXT_BUTTON_FALLBACK = (700, 640)

_MAIL_TAB_ALIASES = {
    "war": "war",
    "wars": "war",
    "report": "reports",
    "reports": "reports",
    "star": "starred",
    "starred": "starred",
}
_MAIL_TAB_LABELS = {
    "war": {"war", "wars"},
    "reports": {"report", "reports"},
    "starred": {"starred", "star"},
}
_MAIL_TAB_FALLBACK_X = {
    "war": 85,
    "reports": 240,
    "starred": 400,
}
_MAIL_TAB_Y = 92


def _get_rapid():
    global _rapid_ocr
    if _rapid_ocr is None:
        from ocr import RapidOCR
        from rapidocr import ModelType

        _rapid_ocr = RapidOCR(
            use_angle_cls=False,
            params={"Det.model_type": ModelType.MOBILE, "Det.limit_side_len": 160},
        )
    return _rapid_ocr


def normalize_mail_tab(tab: str) -> str:
    key = re.sub(r"[^a-z]", "", tab.lower())
    if key not in _MAIL_TAB_ALIASES:
        allowed = ", ".join(sorted({"war", "reports", "starred"}))
        raise ValueError(f"Unknown report tab '{tab}'. Use one of: {allowed}")
    return _MAIL_TAB_ALIASES[key]


def _ocr_text_items(img_bgr, y1: int, y2: int) -> list[dict]:
    crop = img_bgr[y1:y2, :, :]
    if crop.size == 0:
        return []
    result = _get_rapid()(crop)
    if not result or not result[0]:
        return []

    items: list[dict] = []
    for box, text, _conf in result[0]:
        xs = [pt[0] for pt in box]
        ys = [pt[1] for pt in box]
        items.append({
            "text": text,
            "x": int(sum(xs) / len(xs)),
            "y": y1 + int(sum(ys) / len(ys)),
        })
    return items


def _ocr_timestamp_tesseract(img_bgr, entry_y: int) -> list[dict]:
    """Read only the fixed timestamp row with a cheap independent fallback."""
    import cv2
    import pytesseract

    h, w = img_bgr.shape[:2]
    y1 = max(0, entry_y + 35)
    y2 = min(h, entry_y + 75)
    x1, x2 = max(0, 100), min(w, 500)
    crop = img_bgr[y1:y2, x1:x2]
    if crop.size == 0:
        return []
    enlarged = cv2.resize(crop, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    text = pytesseract.image_to_string(enlarged, config="--psm 7").strip()
    if not text:
        return []
    return [{"text": text, "x": (x1 + x2) // 2, "y": (y1 + y2) // 2}]


def _candidate_text_lines(items: list[dict], y_tolerance: int = 14) -> list[str]:
    """Return OCR text joined into approximate visual rows."""
    rows: list[list[dict]] = []
    for item in sorted(items, key=lambda candidate: (candidate["y"], candidate["x"])):
        for row in rows:
            if abs(row[0]["y"] - item["y"]) <= y_tolerance:
                row.append(item)
                break
        else:
            rows.append([item])

    lines: list[str] = []
    for row in rows:
        row.sort(key=lambda candidate: candidate["x"])
        line = " ".join(str(candidate["text"]).strip() for candidate in row if str(candidate["text"]).strip())
        if line:
            lines.append(line)
    return lines


def _extract_report_timestamp(candidates: list[dict]) -> tuple[str, float] | None:
    """Extract a UTC report timestamp from OCR items.

    RapidOCR v3 often splits the date and time into separate boxes, so check
    both individual OCR boxes and reconstructed visual rows.
    """
    import calendar

    texts = [str(item["text"]) for item in candidates]
    texts.extend(_candidate_text_lines(candidates))
    for text in texts:
        match = re.search(r'(\d{4}-\d{2}-\d{2})\s*(\d{2}:\d{2}:\d{2})', text)
        if not match:
            match = re.search(r'(\d{4}-\d{2}-\d{2})\s*(\d{2}:\d{2}):(\d)[.:](\d)', text)
            if match:
                timestamp_str = f"{match.group(1)} {match.group(2)}:{match.group(3)}{match.group(4)}"
            else:
                # RapidOCR can prepend one stray digit to the hour box, e.g.
                # ``303:19:05`` for the valid time ``03:19:05``. Restrict this
                # repair to an otherwise complete three-digit-hour timestamp.
                match = re.search(r'(\d{4}-\d{2}-\d{2})\s*(\d{3}:\d{2}:\d{2})', text)
                if match:
                    timestamp_str = f"{match.group(1)} {match.group(2)[-8:]}"
                else:
                    continue
        else:
            timestamp_str = f"{match.group(1)} {match.group(2)}"
        try:
            timestamp = calendar.timegm(time.strptime(timestamp_str, "%Y-%m-%d %H:%M:%S"))
        except ValueError:
            continue
        return timestamp_str, timestamp
    return None


def _find_mail_tab_target(img_bgr, tab: str) -> tuple[int, int]:
    labels = _MAIL_TAB_LABELS[tab]
    candidates = _ocr_text_items(img_bgr, 40, 180)

    best: tuple[int, int] | None = None
    best_score = 0.0
    for item in candidates:
        cleaned = re.sub(r"[^a-z]", "", item["text"].lower())
        if not cleaned:
            continue
        if cleaned in labels:
            return item["x"], item["y"]
        score = max(difflib.SequenceMatcher(None, cleaned, label).ratio() for label in labels)
        if score > best_score:
            best = (item["x"], item["y"])
            best_score = score

    if best is not None and best_score >= 0.6:
        return best

    return _MAIL_TAB_FALLBACK_X[tab], _MAIL_TAB_Y


def _open_mail_inbox(emulator) -> None:
    goto_world_map(emulator)
    img = emulator.screencap_bgr()
    found, (cx, cy) = find_template(img, TEMPLATE_MAIL_ICON, threshold=0.8)
    if not found:
        # Mail icon not visible on world map — go to city and retry from there
        logging.info("Mail icon not found on world map; navigating to city and retrying")
        goto_city(emulator)
        goto_world_map(emulator)
        img = emulator.screencap_bgr()
        found, (cx, cy) = find_template(img, TEMPLATE_MAIL_ICON, threshold=0.8)
        if not found:
            raise WosNavigationError("Mail icon template not found on world map")
    emulator.tap(cx, cy)
    time.sleep(1.5)


def _select_mail_tab(emulator, tab: str) -> None:
    img = emulator.screencap_bgr()
    cx, cy = _find_mail_tab_target(img, tab)
    emulator.tap(cx, cy)
    time.sleep(1.5)


def _open_report_entry(emulator, index: int) -> None:
    if index not in _REPORT_ENTRY_Y:
        raise ValueError("Report index must be between 1 and 5")

    emulator.tap(_REPORT_ENTRY_X, _REPORT_ENTRY_Y[index])
    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline:
        img = emulator.screencap_bgr()
        found, _ = find_template(img, TEMPLATE_BATTLE_OVERVIEW, threshold=0.8)
        if found:
            return
        time.sleep(0.1)
    raise WosNavigationError(
        f"Report entry {index} did not open a battle report screen within 3s"
    )


def _find_template_in_region(
    img_bgr,
    template_path: str,
    region: tuple[int, int, int, int],
    threshold: float = 0.8,
) -> tuple[bool, tuple[int, int]]:
    x1, y1, x2, y2 = region
    crop = img_bgr[y1:y2, x1:x2, :]
    if crop.size == 0:
        return False, (0, 0)

    found, (cx, cy) = find_template(crop, template_path, threshold=threshold)
    if not found:
        return False, (0, 0)
    return True, (x1 + cx, y1 + cy)


def _is_battle_report_screen(img_bgr) -> bool:
    found, _ = find_template(img_bgr, TEMPLATE_BATTLE_OVERVIEW, threshold=0.8)
    return found


def _tap_next_report(emulator) -> None:
    img = emulator.screencap_bgr()
    found, (cx, cy) = _find_template_in_region(
        img,
        TEMPLATE_REPORT_NEXT_BUTTON,
        _REPORT_NEXT_BUTTON_REGION,
        threshold=0.72,
    )
    if not found:
        cx, cy = _REPORT_NEXT_BUTTON_FALLBACK
        logging.info(
            "Next-report button template not found; using fallback tap at (%d,%d)",
            cx,
            cy,
        )
    emulator.tap(cx, cy)
    time.sleep(1.2)


def _advance_to_next_battle_report(emulator, max_attempts: int = 12) -> None:
    for attempt in range(1, max_attempts + 1):
        _tap_next_report(emulator)
        img = emulator.screencap_bgr()
        if _is_battle_report_screen(img):
            logging.info("Advanced to next battle report after %d tap(s)", attempt)
            return
        logging.info(
            "Next item after tap %d/%d is not a battle report; advancing again",
            attempt,
            max_attempts,
        )

    raise WosNavigationError(
        f"Could not reach the next battle report after {max_attempts} next-button taps"
    )


def _merge_report_and_heroes(report: dict, battle_details: dict) -> dict:
    for pair in battle_details.get("hero_pairs", []):
        if "left_hero" in pair:
            report["left"].setdefault("heroes", []).append(pair["left_hero"])
        if "right_hero" in pair:
            report["right"].setdefault("heroes", []).append(pair["right_hero"])
    return report


def _copy_capture_debug_files(capture: dict, out_root: Path) -> None:
    out_root.mkdir(parents=True, exist_ok=True)
    for key, value in capture.items():
        if key.endswith("_reached"):
            continue
        src = Path(value)
        dst = out_root / src.name
        try:
            if src.exists():
                dst.write_bytes(src.read_bytes())
        except Exception as exc:
            logging.warning(
                "Failed to copy report capture debug artifact key=%s src=%s dst=%s error=%s",
                key,
                src,
                dst,
                exc,
            )


def _next_debug_dir(prefix: str) -> Path:
    root = Path.cwd() / "tmp"
    root.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    base = root / f"{stamp}_{prefix}"
    candidate = base
    suffix = 2
    while candidate.exists():
        candidate = root / f"{base.name}_{suffix:02d}"
        suffix += 1
    candidate.mkdir(parents=True, exist_ok=False)
    return candidate


def _parse_captured_report(
    capture: dict,
    debug_dir: Path | None = None,
    *,
    battle_details: dict | None = None,
) -> dict:
    from parse_battle_details import parse_battle_details
    from parse_report import parse_battle_report

    if capture.get("report_bottom_reached") is not True:
        location = str(debug_dir) if debug_dir is not None else "no debug directory was configured"
        raise ReportBottomNotReachedError(
            "Refusing to parse captured report because report_bottom_reached is false. "
            f"Diagnostics/debug artifacts: {location}"
        )

    started = time.monotonic()
    debug_outdir = str(debug_dir) if debug_dir else None
    # These parsers share cached OCR engines.  Keeping inference serialized is
    # both faster and safer than concurrent calls into the same ONNX session.
    report = parse_battle_report(
        capture["report_top"],
        capture["report_stats"],
        debug_outdir=debug_outdir,
    )
    if battle_details is None:
        battle_details = parse_battle_details(
            capture["bd_top"],
            capture["bd_bot"],
            debug_outdir=debug_outdir,
        )
    merged = _merge_report_and_heroes(report, battle_details)
    logging.info("Parsed captured battle report in %.2fs", time.monotonic() - started)
    return merged


def _capture_and_parse_open_report(emulator, debug_dir: Path | None = None) -> dict:
    from parse_battle_details import parse_battle_details

    def _capture_and_parse(outdir: Path, *, debug: bool) -> dict:
        details_future: Future | None = None
        with ThreadPoolExecutor(max_workers=1, thread_name_prefix="battle-details-ocr") as executor:
            def _start_details_parse(bd_data: dict[str, str]) -> None:
                nonlocal details_future
                details_future = executor.submit(
                    parse_battle_details,
                    bd_data["bd_top"],
                    bd_data["bd_bot"],
                    debug_outdir=str(debug_dir) if debug_dir else None,
                )

            capture = capture_full_report(
                emulator,
                outdir,
                debug=debug,
                battle_details_ready=_start_details_parse,
            )
            if details_future is None:
                raise RuntimeError("Battle-details parser did not start after capture")
            # Details OCR runs while Back/stats capture uses only template
            # matching. Resolve it before report OCR touches the shared engine.
            parsed_details = details_future.result()

        return _parse_captured_report(
            capture,
            debug_dir=debug_dir,
            battle_details=parsed_details,
        )

    if debug_dir is not None:
        debug_dir.mkdir(parents=True, exist_ok=True)
        report = _capture_and_parse(debug_dir, debug=True)
        report["debug_dir"] = str(debug_dir.resolve())
        return report

    with tempfile.TemporaryDirectory(prefix="wos_report_") as tmpdir:
        tmp_path = Path(tmpdir)
        return _capture_and_parse(tmp_path, debug=False)


def _next_capture_run_dir(tab: str) -> Path:
    _CAPTURED_REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    base = _CAPTURED_REPORTS_DIR / f"{stamp}_{tab}"
    candidate = base
    suffix = 2
    while candidate.exists():
        candidate = _CAPTURED_REPORTS_DIR / f"{base.name}_{suffix:02d}"
        suffix += 1
    candidate.mkdir(parents=True, exist_ok=False)
    return candidate


def _save_report_json(report: dict, out_path: Path) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_name(f".{out_path.name}.{os.getpid()}.tmp")
    try:
        tmp_path.write_text(json.dumps(report, indent=2) + "\n")
        tmp_path.replace(out_path)
    finally:
        tmp_path.unlink(missing_ok=True)
    return out_path


def resolve_saved_report_images(image_dir: str | Path) -> dict[str, str]:
    """Resolve saved report views by standard filenames or visible section labels."""
    import cv2

    directory = Path(image_dir).expanduser()
    if not directory.is_dir():
        raise ValueError(f"Saved report image directory does not exist: {directory}")

    image_files = [
        path
        for path in directory.iterdir()
        if path.is_file() and path.suffix.casefold() in _SAVED_REPORT_IMAGE_EXTENSIONS
    ]
    by_stem: dict[str, list[Path]] = {}
    for stem in _SAVED_REPORT_IMAGE_STEMS:
        matches = [path for path in image_files if path.stem.casefold() == stem]
        if len(matches) > 1:
            raise ValueError(
                f"Saved report image directory contains multiple '{stem}' images; "
                f"refusing to guess: {[str(path) for path in sorted(matches)]}"
            )
        by_stem[stem] = matches

    core_stems = ("report_top", "report_stats", "bd_top", "bd_bot")
    if all(by_stem[stem] for stem in core_stems):
        resolved = {stem: str(by_stem[stem][0].resolve()) for stem in core_stems}
        if by_stem["report_bottom"]:
            resolved["report_bottom"] = str(by_stem["report_bottom"][0].resolve())
        return resolved

    if any(by_stem[stem] for stem in _SAVED_REPORT_IMAGE_STEMS):
        missing = [stem for stem in core_stems if not by_stem[stem]]
        raise ValueError(
            "Saved report image directory uses standard filenames but is incomplete; "
            f"missing {missing}: {directory}"
        )

    if len(image_files) < 3:
        raise ValueError(
            "Saved report image directory needs at least three screenshots: "
            f"Battle Overview, Stat Bonuses, and complete Battle Details ({directory})"
        )

    template_paths = {
        "report_top": _TEMPLATES_DIR / "tpl_battle_overview.png",
        "report_stats": _TEMPLATES_DIR / "tpl_stat_bonuses.png",
    }
    templates = {
        key: cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
        for key, path in template_paths.items()
    }
    for key, template in templates.items():
        if template is None:
            raise FileNotFoundError(f"Missing saved-report classifier template: {template_paths[key]}")

    normalized_images: dict[Path, object] = {}
    unreadable: list[str] = []
    for path in sorted(image_files):
        image = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if image is None:
            unreadable.append(str(path))
            continue
        if image.shape[1] != 720:
            scale = 720 / image.shape[1]
            image = cv2.resize(
                image,
                (720, int(round(image.shape[0] * scale))),
                interpolation=cv2.INTER_CUBIC,
            )
        normalized_images[path] = image

    if unreadable:
        raise ValueError(f"Could not read saved report images: {unreadable}")

    def _rank_template(template_key: str, candidates: list[Path]) -> list[tuple[float, Path]]:
        template = templates[template_key]
        ranked: list[tuple[float, Path]] = []
        for path in candidates:
            gray = cv2.cvtColor(normalized_images[path], cv2.COLOR_BGR2GRAY)
            if gray.shape[0] < template.shape[0] or gray.shape[1] < template.shape[1]:
                score = -1.0
            else:
                result = cv2.matchTemplate(gray, template, cv2.TM_CCOEFF_NORMED)
                score = float(cv2.minMaxLoc(result)[1])
            ranked.append((score, path))
        return sorted(ranked, key=lambda item: item[0], reverse=True)

    def _select_view(template_key: str, candidates: list[Path]) -> Path:
        ranked = _rank_template(template_key, candidates)
        best_score, best_path = ranked[0]
        next_score = ranked[1][0] if len(ranked) > 1 else -1.0
        if best_score < 0.50 or best_score - next_score < 0.05:
            raise ValueError(
                f"Could not classify saved {template_key} image unambiguously; "
                f"scores={[(round(score, 3), str(path)) for score, path in ranked]}"
            )
        return best_path

    report_top = _select_view("report_top", sorted(image_files))
    report_stats = _select_view(
        "report_stats",
        [path for path in sorted(image_files) if path != report_top],
    )
    remaining = [path for path in sorted(image_files) if path not in {report_top, report_stats}]
    if len(remaining) != 1:
        from capture_report_top_bottom import _find_text_boxes

        battle_details_matches = [
            path
            for path in remaining
            if _find_text_boxes(normalized_images[path], ("Battle Details",))["Battle Details"]
            is not None
        ]
        if len(battle_details_matches) != 1:
            raise ValueError(
                "Expected exactly one remaining saved image containing 'Battle Details', "
                f"found {len(battle_details_matches)}: {[str(path) for path in battle_details_matches]}"
            )
        battle_details = battle_details_matches[0]
    else:
        battle_details = remaining[0]

    return {
        "report_top": str(report_top.resolve()),
        "report_stats": str(report_stats.resolve()),
        "bd_top": str(battle_details.resolve()),
        "bd_bot": str(battle_details.resolve()),
    }


def _normalize_saved_report_image(source: str, destination: Path) -> str:
    """Write a 720px-wide PNG so fixed report coordinates remain calibrated."""
    import cv2

    image = cv2.imread(source, cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(f"Cannot read saved report image: {source}")
    if image.shape[1] != 720:
        scale = 720 / image.shape[1]
        image = cv2.resize(
            image,
            (720, int(round(image.shape[0] * scale))),
            interpolation=cv2.INTER_CUBIC,
        )
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(destination), image):
        raise RuntimeError(f"Could not write normalized report image: {destination}")
    return str(destination)


def parse_saved_report_images(image_dir: str | Path, *, debug: bool = False) -> dict:
    """Parse a complete battle report from existing screenshots without an emulator."""
    import cv2

    from capture_report_top_bottom import contains_report_end
    from parse_battle_details import parse_battle_details

    images = resolve_saved_report_images(image_dir)
    debug_dir = _next_debug_dir("wos_report_images") if debug else None

    def _parse(work_dir: Path) -> dict:
        normalized: dict[str, str] = {}
        normalized_by_source: dict[str, str] = {}
        for key, source in images.items():
            if source not in normalized_by_source:
                normalized_by_source[source] = _normalize_saved_report_image(
                    source,
                    work_dir / f"{key}.png",
                )
            normalized[key] = normalized_by_source[source]

        bottom_evidence = "dedicated report bottom not supplied"
        if "report_bottom" in normalized:
            report_bottom = cv2.imread(normalized["report_bottom"], cv2.IMREAD_COLOR)
            if report_bottom is None:
                raise FileNotFoundError(
                    f"Cannot read saved report bottom image: {images['report_bottom']}"
                )
            bottom_reached, bottom_evidence = contains_report_end(report_bottom)
            if not bottom_reached:
                raise ReportBottomNotReachedError(
                    "Refusing to parse saved report images because report_bottom does not "
                    f"confirm the Battle Details boundary ({bottom_evidence}, "
                    f"screenshot={images['report_bottom']})"
                )

        battle_details = parse_battle_details(
            normalized["bd_top"],
            normalized["bd_bot"],
            debug_outdir=str(debug_dir) if debug_dir else None,
            require_complete=True,
        )
        capture = {
            **normalized,
            # For shared screenshot sets, completeness is established by the
            # dedicated stats page plus Battle Details summary boundary.
            "report_bottom_reached": True,
        }
        report = _parse_captured_report(
            capture,
            debug_dir=debug_dir,
            battle_details=battle_details,
        )
        report["source_images"] = images
        report["report_completeness_validation"] = {
            "battle_details_summary_boundary": True,
            "report_bottom": bottom_evidence,
        }
        if debug_dir is not None:
            report["debug_dir"] = str(debug_dir.resolve())
        return report

    if debug_dir is not None:
        return _parse(debug_dir / "normalized")
    with tempfile.TemporaryDirectory(prefix="wos_report_images_") as tmpdir:
        return _parse(Path(tmpdir))


def get_latest_report_timestamp(emulator, tab: str) -> float:
    """Read the timestamp of the latest report in the given tab.
    
    Returns the UTC calendar timestamp (seconds since epoch) of the newest
    report.  A missing/unreadable timestamp is an error: treating it as zero
    would allow an older report to masquerade as the battle about to run.
    """
    _open_mail_inbox(emulator)
    _select_mail_tab(emulator, tab)
    img = emulator.screencap_bgr()
    candidates = _ocr_text_items(img, _REPORT_ENTRY_Y[1], _REPORT_ENTRY_Y[1] + 150)
    parsed = _extract_report_timestamp(candidates)
    if parsed is None:
        candidates = _ocr_timestamp_tesseract(img, _REPORT_ENTRY_Y[1])
        parsed = _extract_report_timestamp(candidates)
    if parsed is not None:
        timestamp_str, timestamp = parsed
        logging.info("get_latest_report_timestamp: latest report = %s (%.0f)", timestamp_str, timestamp)
        return timestamp
    debug_path = "/tmp/get_latest_report_timestamp_failed.png"
    try:
        import cv2
        cv2.imwrite(debug_path, img)
    except Exception:
        debug_path = "unavailable"
    raise WosNavigationError(
        "Could not establish the latest report timestamp before battle; "
        f"refusing to risk capturing a stale report (OCR={candidates}, screenshot={debug_path})"
    )


def wait_for_new_report(
    emulator,
    tab: str,
    after: float,
    timeout_sec: int = 300,
    poll_sec: int = 5,
) -> float | None:
    """Wait for and return the timestamp of a new report.

    On success the requested inbox tab remains open.  The caller can therefore
    open the exact entry it just detected without navigating away and risking a
    different report taking index 1.
    """
    # open the inbox and select the tab to ensure we're looking at the right place
    _open_mail_inbox(emulator)
    _select_mail_tab(emulator, tab)
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        img = emulator.screencap_bgr()
        # Check the first report entry for a timestamp newer than 'after'
        candidates = _ocr_text_items(img, _REPORT_ENTRY_Y[1], _REPORT_ENTRY_Y[1] + 150)
        # Convert from YYYY-MM-DD HH:MM:SS format to UTC timestamp and compare with 'after'
        found_ts = None
        parsed = _extract_report_timestamp(candidates)
        if parsed is None:
            candidates = _ocr_timestamp_tesseract(img, _REPORT_ENTRY_Y[1])
            parsed = _extract_report_timestamp(candidates)
        if parsed is not None:
            timestamp_str, timestamp = parsed
            found_ts = timestamp
            if timestamp > after:
                logging.info("wait_for_new_report: found report with timestamp %s (%.0f > %.0f)", timestamp_str, timestamp, after)
                return timestamp
        if found_ts is not None:
            logging.info("wait_for_new_report: latest report timestamp %.0f, waiting for > %.0f", found_ts, after)
        else:
            logging.info("wait_for_new_report: no timestamp found in OCR, retrying...")
            # Save a debug screencap on first miss
            try:
                import cv2
                debug_path = "/tmp/wait_for_new_report_debug.png"
                cv2.imwrite(debug_path, img)
                logging.info("wait_for_new_report: saved debug screencap to %s", debug_path)
                # Also log what OCR actually found
                logging.info("wait_for_new_report: OCR candidates: %s", candidates)
            except Exception:
                pass
        # No new report found yet, wait and try again
        time.sleep(poll_sec)
    return None


def read_battle_report_from_open_inbox(
    emulator,
    index: int = 1,
    debug: bool = False,
    *,
    tab: str = "war",
) -> dict:
    """Parse a battle report when its inbox tab is already visible."""
    debug_dir = None
    if debug:
        debug_dir = _next_debug_dir(f"wos_report_{normalize_mail_tab(tab)}_{index}")

    try:
        _open_report_entry(emulator, index)
        return _capture_and_parse_open_report(emulator, debug_dir=debug_dir)
    except Exception as exc:
        if debug_dir is not None:
            raise type(exc)(f"{exc} Debug artifacts: {debug_dir.resolve()}") from exc
        raise

def read_battle_report(emulator, tab: str, index: int = 1, debug: bool = False) -> dict:
    """Open a report from the given inbox tab and return merged parsed JSON.

    If debug=True, captures and parser diagnostics are persisted under ./tmp/<temp_name>/.
    """
    normalized_tab = normalize_mail_tab(tab)
    _open_mail_inbox(emulator)
    _select_mail_tab(emulator, normalized_tab)
    return read_battle_report_from_open_inbox(
        emulator,
        index=index,
        debug=debug,
        tab=normalized_tab,
    )


def capture_multiple_reports(emulator, tab: str, count: int, debug: bool = False) -> list[str]:
    """Capture, parse, and save multiple consecutive battle reports.

    Starts from the first visible report entry in the requested inbox tab, saves
    each merged report JSON under ``wos/captures/reports/<run>/``, and returns
    the saved JSON paths.
    """
    normalized_tab = normalize_mail_tab(tab)
    if count < 1:
        raise ValueError("Report count must be at least 1")

    _open_mail_inbox(emulator)
    _select_mail_tab(emulator, normalized_tab)
    _open_report_entry(emulator, 1)

    out_root = _next_capture_run_dir(normalized_tab)
    debug_root = None
    if debug:
        debug_root = _next_debug_dir(out_root.name)

    saved_paths: list[str] = []
    for report_num in range(1, count + 1):
        report_debug_dir = None
        if debug_root is not None:
            report_debug_dir = debug_root / f"report_{report_num:02d}"

        merged = _capture_and_parse_open_report(emulator, debug_dir=report_debug_dir)
        saved = _save_report_json(merged, out_root / f"report_{report_num:02d}.json")
        saved_paths.append(str(saved.resolve()))

        if report_num < count:
            _advance_to_next_battle_report(emulator)

    return saved_paths
