"""Capture a full WOS battle report.

1. report_top.png    — Battle Overview (report top)
2. report_bottom.png — confirmed report bottom, with Battle Details visible
3. bd_top.png        — Battle Details top
4. bd_bot.png        — Battle Details bottom
5. report_stats.png  — troop slots + full Stat Bonuses in one framed capture

Bottom detection uses template matching to find the "Battle Details" button
(report). The stats capture is validated at capture time by keeping the
"Stat Bonuses" OCR box within a measured usable y-band.
"""
from __future__ import annotations

import logging
import json
import re
import time
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

from emulator import WosEmulator

logger = logging.getLogger(__name__)
_rapid_ocr = None
_skill_dir = Path(__file__).resolve().parent.parent
_tpl_dir = _skill_dir / "templates"

_STAT_BONUSES_REF_HEIGHT = 1280
_STAT_BONUSES_Y_BAND = (280, 429)
_STATS_CAPTURE_MAX_ATTEMPTS = 10
_BATTLE_DETAILS_BUTTON_TEMPLATE = _tpl_dir / "battle_details_button.png"
_BATTLE_DETAILS_BUTTON_THRESHOLD = 0.80

# ── Battle Details button location (fallback only) ─────────────────────────────
BD_BUTTON_X, BD_BUTTON_Y = 185, 970

_REPORT_DIAGNOSTICS_DIR = _skill_dir / "captures" / "report_diagnostics"


class ReportBottomNotReachedError(RuntimeError):
    """Raised when a report capture cannot prove it reached the report bottom."""


def _get_rapid():
    global _rapid_ocr
    if _rapid_ocr is None:
        from ocr import RapidOCR

        _rapid_ocr = RapidOCR()
    return _rapid_ocr


# ── Bottom detection ───────────────────────────────────────────────────────────
def _end_region(img_bgr):
    """Return a crop just above the footer where end buttons would appear."""
    h, w = img_bgr.shape[:2]
    footer_h = 103
    y2 = max(0, h - footer_h)
    y1 = max(0, y2 - 360)
    return img_bgr[y1:y2, :, :]


def _write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, default=str) + "\n")


def _write_bottom_detection_debug(debug_dir: Path, stem: str, img_bgr: np.ndarray) -> None:
    debug_dir.mkdir(parents=True, exist_ok=True)
    band = _end_region(img_bgr)
    cv2.imwrite(str(debug_dir / f"{stem}_frame.png"), img_bgr)
    cv2.imwrite(str(debug_dir / f"{stem}_end_region.png"), band)


def contains_report_end(img_bgr) -> tuple[bool, str]:
    """Detect report bottom by template-matching the Battle Details button."""
    match = _find_battle_details_button(img_bgr)
    if match is None:
        return False, "battle_details_button not found"
    x, y, score = match
    return True, f"battle_details_button found at ({x},{y}) score={score:.3f}"


def _find_text_box(img_bgr: np.ndarray, needle: str) -> tuple[int, int, float] | None:
    """Return (y1, y2, confidence) of the best OCR box matching needle."""
    needle_clean = re.sub(r"\s+", "", needle.lower())
    result = _get_rapid()(img_bgr)
    if not result or not result[0]:
        return None

    best = None
    for box, text, conf in result[0]:
        text_clean = re.sub(r"\s+", "", str(text).lower())
        if needle_clean in text_clean:
            ys = [pt[1] for pt in box]
            cand = (int(min(ys)), int(max(ys)), float(conf))
            if best is None or cand[2] > best[2]:
                best = cand
    return best


def _validate_report_top(img_bgr: np.ndarray, source_path: Path) -> dict[str, object]:
    """Fail fast if the top capture is not the expected battle report view."""
    battle_box = _find_text_box(img_bgr, "Battle Overview")
    bonus_box = _find_text_box(img_bgr, "Bonus Source")
    if battle_box is None or bonus_box is None:
        raise RuntimeError(
            "Report top validation failed; expected OCR markers were missing "
            f"(Battle Overview={battle_box}, Bonus Source={bonus_box}, screenshot={source_path})"
        )
    return {"battle_overview_box": battle_box, "bonus_source_box": bonus_box, "source": str(source_path)}


def _stat_bonuses_y_band(image_height: int) -> tuple[int, int]:
    scale = image_height / _STAT_BONUSES_REF_HEIGHT
    return int(round(_STAT_BONUSES_Y_BAND[0] * scale)), int(round(_STAT_BONUSES_Y_BAND[1] * scale))


def _inspect_stats_frame(img_bgr: np.ndarray) -> dict[str, object]:
    """Inspect whether Stat Bonuses is positioned inside the capture-time band."""
    sb_box = _find_text_box(img_bgr, "Stat Bonuses")
    low, high = _stat_bonuses_y_band(img_bgr.shape[0])
    sb_top = sb_box[0] if sb_box else None
    in_band = bool(sb_top is not None and low <= sb_top <= high)
    distance = 9999 if sb_top is None else min(abs(sb_top - low), abs(sb_top - high)) if not in_band else 0
    score = -float(distance)
    if sb_box:
        score += min(sb_box[2], 1.0)

    return {
        "sb_box": sb_box,
        "sb_top": sb_top,
        "band": (low, high),
        "parseable": in_band,
        "score": score,
    }


def _drag_vertical(emulator: WosEmulator, delta_px: int, dur_ms: int = 500) -> None:
    """Perform a small controlled vertical drag around screen centre."""
    if delta_px == 0:
        return
    y1 = 640
    y2 = int(np.clip(y1 + delta_px, 180, 1140))
    if y1 == y2:
        return
    emulator.swipe(360, y1, 360, y2, dur_ms)


def _capture_stats_with_retries(
    emulator: WosEmulator,
    outdir: Path,
    prefix: str,
    debug: bool = False,
    max_attempts: int = 10,
) -> str:
    """Capture one screenshot containing full troop slots and all stat rows."""
    stats_path = outdir / f"{prefix}_stats.png"
    best_img = None
    best_state = None
    attempts: list[dict[str, object]] = []

    for attempt in range(max_attempts):
        img = emulator.screencap_bgr()
        state = _inspect_stats_frame(img)
        attempts.append({"attempt": attempt, **state})

        if debug:
            cv2.imwrite(str(outdir / f"{prefix}_stats_attempt_{attempt:02d}.png"), img)
            logger.info(
                "Stats-frame attempt %d: parseable=%s sb_top=%s band=%s sb=%s score=%.3f",
                attempt,
                state["parseable"],
                state["sb_top"],
                state["band"],
                state["sb_box"],
                state["score"],
            )

        if best_state is None or float(state["score"]) > float(best_state["score"]):
            best_img = img
            best_state = state

        if state["parseable"]:
            cv2.imwrite(str(stats_path), img)
            if debug:
                _write_json(
                    outdir / f"{prefix}_stats_capture_attempts.json",
                    {"selected_attempt": attempt, "selected_path": str(stats_path), "attempts": attempts},
                )
            return str(stats_path)

        if attempt == max_attempts - 1:
            break

        low, high = state["band"]
        sb_top = state["sb_top"]
        if sb_top is None:
            delta = 140
        elif int(sb_top) < low:
            # Drag down to move report content down and reveal more troop row.
            delta = 95
        elif int(sb_top) > high:
            # Drag up to move report content up and keep Marksman Health visible.
            delta = -75
        else:
            delta = 0

        _drag_vertical(emulator, delta)
        time.sleep(0.45)

    if best_img is not None:
        cv2.imwrite(str(stats_path), best_img)
    if debug:
        _write_json(
            outdir / f"{prefix}_stats_capture_attempts.json",
            {"selected_attempt": None, "selected_path": str(stats_path), "attempts": attempts},
        )
    raise RuntimeError(
        "Stats capture failed after "
        f"{max_attempts} attempts; best observed frame was not parseable (state={best_state}, saved={stats_path})"
    )


# ── Scroll helpers ─────────────────────────────────────────────────────────────
def scroll_to_top(emulator: WosEmulator, swipes: int = 6) -> None:
    """Scroll up to reach the top of the page."""
    for _ in range(swipes):
        emulator.swipe(360, 300, 360, 1200, 800)
        time.sleep(0.35)


def scroll_to_bottom(
    emulator: WosEmulator,
    detect_fn: Callable[[np.ndarray], tuple[bool, str]],
    max_steps: int = 30,
    debug: bool = False,
    debug_dir: Path | None = None,
    diagnostic_events: list[dict[str, object]] | None = None,
) -> bool:
    """Repeatedly swipe up until detect_fn confirms the report end.

    Image stability only means scrolling stopped. It is diagnostic context, not
    proof that the report-end marker is visible.
    """
    prev_hash = None

    for step in range(max_steps):
        img = emulator.screencap_bgr()
        hit, snippet = detect_fn(img)
        event = {"step": step, "event": "detect", "end_found": hit, "snippet": snippet}
        if debug_dir is not None:
            _write_bottom_detection_debug(debug_dir, f"bottom_step_{step:02d}", img)
        if debug:
            print(f'step {step:02d}: end={hit} text="{snippet}"')
        if diagnostic_events is not None:
            diagnostic_events.append(event)
        if hit:
            return True

        # Check if content stopped scrolling (image unchanged)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        curr_hash = gray[200:-200, :].mean()
        if prev_hash is not None and abs(curr_hash - prev_hash) < 0.5:
            if debug:
                print(f'step {step:02d}: content stopped scrolling')
            if diagnostic_events is not None:
                diagnostic_events.append({
                    "step": step,
                    "event": "scroll_stopped",
                    "previous_mean": prev_hash,
                    "current_mean": curr_hash,
                    "delta": abs(curr_hash - prev_hash),
                })
            break
        prev_hash = curr_hash

        emulator.swipe(360, 1120, 360, 120, 700)
        time.sleep(0.55)

    for retry in range(1, 4):
        img = emulator.screencap_bgr()
        hit, snippet = detect_fn(img)
        if debug_dir is not None:
            _write_bottom_detection_debug(debug_dir, f"bottom_retry_{retry:02d}", img)
        if diagnostic_events is not None:
            diagnostic_events.append({
                "retry": retry,
                "event": "confirm_retry",
                "end_found": hit,
                "snippet": snippet,
            })
        if debug:
            print(f'retry {retry}: end={hit} text="{snippet}"')
        if hit:
            return True
        time.sleep(0.35)

    return False


def _save_bottom_failure_diagnostics(
    emulator: WosEmulator,
    outdir: Path,
    prefix: str,
    events: list[dict[str, object]],
) -> Path:
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    diag_dir = _REPORT_DIAGNOSTICS_DIR / f"{stamp}_{prefix}"
    suffix = 2
    while diag_dir.exists():
        diag_dir = _REPORT_DIAGNOSTICS_DIR / f"{stamp}_{prefix}_{suffix:02d}"
        suffix += 1
    diag_dir.mkdir(parents=True, exist_ok=False)

    final_path = diag_dir / "bottom_detection_failure.png"
    emulator.screencap(str(final_path))
    metadata = {
        "error": "report_bottom_not_confirmed",
        "source_outdir": str(outdir),
        "final_screenshot": str(final_path),
        "events": events,
    }
    (diag_dir / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    return diag_dir


# ── Public capture functions ───────────────────────────────────────────────────
def capture_report(
    emulator: WosEmulator,
    outdir: Path,
    prefix: str = "report",
    debug: bool = False,
) -> dict[str, str | bool]:
    """Capture report_top and confirm report bottom.

    Assumes report is already open at top.

    - report_top: Battle Overview (top)
    - report_bottom: bottom area with the Battle Details button visible
    """
    outdir.mkdir(parents=True, exist_ok=True)
    top_path = outdir / f'{prefix}_top.png'
    emulator.screencap(str(top_path))
    top_img = cv2.imread(str(top_path))
    if top_img is None:
        raise FileNotFoundError(f"Cannot read top screenshot after capture: {top_path}")
    top_validation = _validate_report_top(top_img, top_path)
    if debug:
        _write_json(outdir / f"{prefix}_top_validation.json", top_validation)

    bottom_events: list[dict[str, object]] = []
    ok = scroll_to_bottom(
        emulator,
        contains_report_end,
        debug=debug,
        debug_dir=outdir if debug else None,
        diagnostic_events=bottom_events,
    )
    bottom_path = outdir / f'{prefix}_bottom.png'
    emulator.screencap(str(bottom_path))

    if not ok:
        diag_dir = _save_bottom_failure_diagnostics(emulator, outdir, prefix, bottom_events)
        raise ReportBottomNotReachedError(
            "Report bottom could not be confirmed; refusing to parse partial capture. "
            f"Diagnostics saved to {diag_dir}"
        )

    if debug:
        _write_json(outdir / f"{prefix}_bottom_detection_events.json", bottom_events)

    return {
        "report_top": str(top_path),
        "report_bottom": str(bottom_path),
        "report_bottom_reached": ok,
    }


def _find_battle_details_button(img_bgr: np.ndarray) -> tuple[int, int, float] | None:
    """Find the Battle Details button centre via template matching."""
    template = cv2.imread(str(_BATTLE_DETAILS_BUTTON_TEMPLATE), cv2.IMREAD_COLOR)
    if template is None:
        raise FileNotFoundError(f"Template not found: {_BATTLE_DETAILS_BUTTON_TEMPLATE}")
    if img_bgr.shape[0] < template.shape[0] or img_bgr.shape[1] < template.shape[1]:
        return None

    result = cv2.matchTemplate(img_bgr, template, cv2.TM_CCOEFF_NORMED)
    _, score, _, loc = cv2.minMaxLoc(result)
    if score < _BATTLE_DETAILS_BUTTON_THRESHOLD:
        return None

    th, tw = template.shape[:2]
    return loc[0] + tw // 2, loc[1] + th // 2, float(score)


def capture_battle_details(
    emulator: WosEmulator,
    outdir: Path,
    prefix: str = "bd",
    debug: bool = False,
) -> dict[str, str]:
    """Tap Battle Details, capture bd_top and bd_bot. Assumes report bottom is visible."""
    outdir.mkdir(parents=True, exist_ok=True)

    # Find the Battle Details button via template match on the current screen
    img = emulator.screencap_bgr()
    btn_match = _find_battle_details_button(img)
    if btn_match is not None:
        bx, by, score = btn_match
        logger.info("Battle Details button found via template at (%d, %d), score %.3f", bx, by, score)
    else:
        bx, by = BD_BUTTON_X, BD_BUTTON_Y
        score = None
        logger.warning("Battle Details button template not found; using fallback (%d, %d)", bx, by)
    if debug:
        cv2.imwrite(str(outdir / f"{prefix}_button_search.png"), img)
        _write_json(
            outdir / f"{prefix}_button_search.json",
            {
                "button_position": [bx, by] if btn_match is not None else None,
                "button_score": score,
                "tap_position": [bx, by],
                "used_fallback": btn_match is None,
            },
        )

    emulator.tap(bx, by)
    time.sleep(1.5)

    # Already at top when BD opens — no scroll needed
    top_path = outdir / f'{prefix}_top.png'
    emulator.screencap(str(top_path))

    # Small scroll down (less than half screen) to reveal remaining heroes
    emulator.swipe(360, 800, 360, 500, 500)
    time.sleep(0.5)

    bot_path = outdir / f'{prefix}_bot.png'
    emulator.screencap(str(bot_path))

    emulator.back()
    time.sleep(1.0)

    return {
        "bd_top": str(top_path),
        "bd_bot": str(bot_path),
    }


def capture_report_stats(
    emulator: WosEmulator,
    outdir: Path,
    prefix: str = "report",
    debug: bool = False,
) -> dict[str, str]:
    """After returning from Battle Details at report bottom, frame troop slots + stats."""
    outdir.mkdir(parents=True, exist_ok=True)
    stats_path = _capture_stats_with_retries(
        emulator,
        outdir,
        prefix,
        debug=debug,
        max_attempts=_STATS_CAPTURE_MAX_ATTEMPTS,
    )
    return {"report_stats": stats_path}


def capture_full_report(
    emulator: WosEmulator,
    outdir: Path,
    debug: bool = False,
) -> dict[str, str | bool]:
    """Capture all 4 screenshots for a single report."""
    outdir.mkdir(parents=True, exist_ok=True)

    logger.info("Capturing battle report top and bottom to %s", outdir)
    report_data = capture_report(emulator, outdir, debug=debug)

    logger.info("Capturing battle details to %s", outdir)
    bd_data = capture_battle_details(emulator, outdir, debug=debug)

    logger.info("Capturing framed report stats to %s", outdir)
    stats_data = capture_report_stats(emulator, outdir, debug=debug)

    return report_data | bd_data | stats_data
