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
from scroll_capture import save_stitched_screenshot, stitch_scrolling_frames

logger = logging.getLogger(__name__)
_rapid_ocr = None
_skill_dir = Path(__file__).resolve().parent.parent
_tpl_dir = _skill_dir / "templates"

_STAT_BONUSES_REF_HEIGHT = 1280
_STAT_BONUSES_Y_BAND = (280, 429)
_STATS_CAPTURE_MAX_ATTEMPTS = 10
_BATTLE_DETAILS_BUTTON_TEMPLATE = _tpl_dir / "battle_details_button.png"
_BATTLE_DETAILS_BUTTON_THRESHOLD = 0.80
_BATTLE_OVERVIEW_TEMPLATE = _tpl_dir / "tpl_battle_overview.png"
_STAT_BONUSES_TEMPLATE = _tpl_dir / "tpl_stat_bonuses.png"
_STAT_BONUSES_TEMPLATE_THRESHOLD = 0.72
_SCREEN_CHANGE_MEAN_THRESHOLD = 5.0
_SCREEN_STABLE_MEAN_THRESHOLD = 1.5
_REPORT_CONTENT_TOP_REF = 86
# Stop before the fixed snowy strip above the mail action bar. Including even
# its upper edge repeats a pale horizontal stripe at every stitched join.
_REPORT_CONTENT_BOTTOM_REF = 1172

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
    """Detect report bottom via template match, with OCR fallback for the Battle Details button."""
    match = _find_battle_details_button(img_bgr)
    if match is not None:
        x, y, score = match
        return True, f"battle_details_button found at ({x},{y}) score={score:.3f}"
    # OCR fallback: template match can miss due to rendering variance across runs
    box = _find_text_box(img_bgr, "Battle Details")
    if box is not None:
        return True, f"battle_details_button OCR fallback y=({box[0]},{box[1]}) conf={box[2]:.3f}"
    return False, "battle_details_button not found"


def _find_text_boxes(
    img_bgr: np.ndarray,
    needles: tuple[str, ...],
) -> dict[str, tuple[int, int, float] | None]:
    """Find several OCR labels with one inference over the screenshot."""
    cleaned_needles = {
        needle: re.sub(r"\s+", "", needle.lower())
        for needle in needles
    }
    best: dict[str, tuple[int, int, float] | None] = {
        needle: None for needle in needles
    }
    result = _get_rapid()(img_bgr)
    if not result or not result[0]:
        return best

    for box, text, conf in result[0]:
        text_clean = re.sub(r"\s+", "", str(text).lower())
        ys = [pt[1] for pt in box]
        cand = (int(min(ys)), int(max(ys)), float(conf))
        for needle, needle_clean in cleaned_needles.items():
            if needle_clean not in text_clean:
                continue
            if best[needle] is None or cand[2] > best[needle][2]:
                best[needle] = cand
    return best


def _find_text_box(img_bgr: np.ndarray, needle: str) -> tuple[int, int, float] | None:
    """Return (y1, y2, confidence) of the best OCR box matching needle."""
    return _find_text_boxes(img_bgr, (needle,))[needle]


def _validate_report_top(img_bgr: np.ndarray, source_path: Path) -> dict[str, object]:
    """Fail fast if the top capture is not the expected battle report view."""
    template = cv2.imread(str(_BATTLE_OVERVIEW_TEMPLATE), cv2.IMREAD_COLOR)
    if template is None:
        raise FileNotFoundError(f"Template not found: {_BATTLE_OVERVIEW_TEMPLATE}")
    result = cv2.matchTemplate(img_bgr, template, cv2.TM_CCOEFF_NORMED)
    _, score, _, loc = cv2.minMaxLoc(result)
    if score < 0.80:
        raise RuntimeError(
            "Report top validation failed; Battle Overview template was missing "
            f"(score={score:.3f}, threshold=0.800, screenshot={source_path})"
        )
    th, tw = template.shape[:2]
    return {
        "battle_overview_box": (loc[0], loc[1], loc[0] + tw, loc[1] + th),
        "battle_overview_score": float(score),
        "source": str(source_path),
    }


def _stat_bonuses_y_band(image_height: int) -> tuple[int, int]:
    scale = image_height / _STAT_BONUSES_REF_HEIGHT
    return int(round(_STAT_BONUSES_Y_BAND[0] * scale)), int(round(_STAT_BONUSES_Y_BAND[1] * scale))


def _find_stat_bonuses_box(img_bgr: np.ndarray) -> tuple[int, int, float] | None:
    """Locate the stable Stat Bonuses heading cheaply, with OCR fallback."""
    template = cv2.imread(str(_STAT_BONUSES_TEMPLATE), cv2.IMREAD_COLOR)
    if template is not None:
        th, tw = template.shape[:2]
        if img_bgr.shape[0] >= th and img_bgr.shape[1] >= tw:
            result = cv2.matchTemplate(img_bgr, template, cv2.TM_CCOEFF_NORMED)
            _, score, _, loc = cv2.minMaxLoc(result)
            if score >= _STAT_BONUSES_TEMPLATE_THRESHOLD:
                # The template is cropped around the glyph bodies while OCR's
                # box includes their antialiased upper margin.  Preserve the
                # capture band's OCR-calibrated coordinate system.
                y1 = max(0, loc[1] - 12)
                return y1, loc[1] + th, float(score)
    return _find_text_box(img_bgr, "Stat Bonuses")


def _inspect_stats_frame(img_bgr: np.ndarray) -> dict[str, object]:
    """Inspect whether Stat Bonuses is positioned inside the capture-time band."""
    sb_box = _find_stat_bonuses_box(img_bgr)
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
    initial_frame: np.ndarray | None = None,
) -> str:
    """Capture one screenshot containing full troop slots and all stat rows."""
    stats_path = outdir / f"{prefix}_stats.png"
    best_img = None
    best_state = None
    attempts: list[dict[str, object]] = []

    for attempt in range(max_attempts):
        img = initial_frame if attempt == 0 and initial_frame is not None else emulator.screencap_bgr()
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
        time.sleep(0.2)

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
    fallback_detect_fn: Callable[[np.ndarray], tuple[bool, str]] | None = None,
    fallback_every: int = 4,
    frames_out: list[np.ndarray] | None = None,
) -> bool:
    """Swipe down until the fast detector or periodic fallback confirms the end."""
    for step in range(max_steps + 1):
        img = emulator.screencap_bgr()
        if frames_out is not None:
            frames_out.append(img.copy())
        hit, snippet = detect_fn(img)
        used_fallback = False
        if (
            not hit
            and fallback_detect_fn is not None
            and (step == max_steps or (step > 0 and step % max(1, fallback_every) == 0))
        ):
            hit, snippet = fallback_detect_fn(img)
            used_fallback = True
        event = {"step": step, "event": "detect", "end_found": hit, "snippet": snippet}
        if used_fallback:
            event["fallback"] = True
        if debug_dir is not None:
            _write_bottom_detection_debug(debug_dir, f"bottom_step_{step:02d}", img)
        if debug:
            print(f'step {step:02d}: end={hit} text="{snippet}"')
        if diagnostic_events is not None:
            diagnostic_events.append(event)
        if hit:
            return True

        if step == max_steps:
            break

        if frames_out is None:
            emulator.swipe(360, 1120, 360, 120, 450)
        else:
            # Long screenshots need substantial overlap between viewports.
            # The normal 1000px gesture can coast beyond one viewport and
            # leave an unrecoverable gap even when the bottom capture succeeds.
            emulator.swipe(360, 920, 360, 470, 450)
        time.sleep(0.2)

    return False


def stitch_report_frames(
    frames: list[np.ndarray],
    *,
    content_bounds: tuple[int, int] | None = None,
) -> np.ndarray:
    """Stitch scrolled report frames into one long, readable screenshot."""
    if not frames:
        raise ValueError("Cannot stitch an empty report frame list")
    height = frames[0].shape[0]
    if content_bounds is None:
        content_top = int(round(_REPORT_CONTENT_TOP_REF * height / _STAT_BONUSES_REF_HEIGHT))
        content_bottom = int(round(_REPORT_CONTENT_BOTTOM_REF * height / _STAT_BONUSES_REF_HEIGHT))
    else:
        content_top, content_bottom = content_bounds
    return stitch_scrolling_frames(
        frames,
        content_bounds=(content_top, content_bottom),
    )


def save_long_report_screenshot(frames: list[np.ndarray], output_path: str | Path) -> str:
    """Stitch report frames and write the resulting PNG atomically enough for CLI use."""
    stitched = stitch_report_frames(frames)
    return save_stitched_screenshot(stitched, output_path)


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
    long_screenshot_path: str | Path | None = None,
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
    last_bottom_frame: list[np.ndarray] = []
    scroll_frames: list[np.ndarray] | None = [] if long_screenshot_path is not None else None

    def _detect_bottom(img: np.ndarray) -> tuple[bool, str]:
        last_bottom_frame[:] = [img]
        match = _find_battle_details_button(img)
        if match is None:
            return False, "battle_details_button template not found"
        return True, f"battle_details_button found at ({match[0]},{match[1]}) score={match[2]:.3f}"

    ok = scroll_to_bottom(
        emulator,
        _detect_bottom,
        debug=debug,
        debug_dir=outdir if debug else None,
        diagnostic_events=bottom_events,
        fallback_detect_fn=contains_report_end,
        frames_out=scroll_frames,
    )
    bottom_path = outdir / f'{prefix}_bottom.png'
    if last_bottom_frame:
        cv2.imwrite(str(bottom_path), last_bottom_frame[0])
    else:
        emulator.screencap(str(bottom_path))

    if not ok:
        diag_dir = _save_bottom_failure_diagnostics(emulator, outdir, prefix, bottom_events)
        raise ReportBottomNotReachedError(
            "Report bottom could not be confirmed; refusing to parse partial capture. "
            f"Diagnostics saved to {diag_dir}"
        )

    if debug:
        _write_json(outdir / f"{prefix}_bottom_detection_events.json", bottom_events)

    result: dict[str, str | bool] = {
        "report_top": str(top_path),
        "report_bottom": str(bottom_path),
        "report_bottom_reached": ok,
    }
    if long_screenshot_path is not None:
        result["report_long"] = save_long_report_screenshot(
            scroll_frames or [top_img],
            long_screenshot_path,
        )
    return result


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


def _mean_frame_delta(first: np.ndarray, second: np.ndarray) -> float:
    if first.shape != second.shape:
        return float("inf")
    return float(np.mean(cv2.absdiff(first, second)))


def _wait_for_changed_stable_frame(
    emulator: WosEmulator,
    before: np.ndarray,
    *,
    timeout_sec: float = 2.5,
) -> np.ndarray:
    """Wait until a transition visibly changes and then settles."""
    deadline = time.monotonic() + timeout_sec
    unchanged_button_deadline = time.monotonic() + 1.0
    changed_frame = None
    while time.monotonic() < deadline:
        current = emulator.screencap_bgr()
        # A tap ripple or tiny report scroll is not proof that Battle Details
        # opened. The button must disappear before accepting a changed frame.
        if _find_battle_details_button(current) is not None:
            if time.monotonic() >= unchanged_button_deadline:
                raise RuntimeError("Battle Details button remained visible after tap")
            changed_frame = None
            time.sleep(0.08)
            continue
        if changed_frame is None:
            if _mean_frame_delta(before, current) >= _SCREEN_CHANGE_MEAN_THRESHOLD:
                changed_frame = current
        elif _mean_frame_delta(
            changed_frame[120:260, 160:560],
            current[120:260, 160:560],
        ) <= _SCREEN_STABLE_MEAN_THRESHOLD:
            return current
        else:
            changed_frame = current
        time.sleep(0.08)
    raise RuntimeError("Battle Details screen did not visibly open and settle within 2.5s")


def _wait_for_report_bottom(
    emulator: WosEmulator,
    *,
    timeout_sec: float = 2.5,
) -> np.ndarray:
    """Wait until Back has returned to the report's confirmed bottom view."""
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        current = emulator.screencap_bgr()
        match = _find_battle_details_button(current)
        if match is not None:
            return current
        time.sleep(0.08)
    raise RuntimeError("Report bottom did not reappear after closing Battle Details")


def capture_battle_details(
    emulator: WosEmulator,
    outdir: Path,
    prefix: str = "bd",
    debug: bool = False,
    initial_frame: np.ndarray | None = None,
    return_frame_out: list[np.ndarray] | None = None,
) -> dict[str, str]:
    """Tap Battle Details, capture bd_top and bd_bot. Assumes report bottom is visible."""
    outdir.mkdir(parents=True, exist_ok=True)

    # Find the Battle Details button via template match on the current screen
    img = initial_frame if initial_frame is not None else emulator.screencap_bgr()
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

    top_img = None
    for open_attempt in range(2):
        emulator.tap(bx, by)
        try:
            top_img = _wait_for_changed_stable_frame(emulator, img)
            break
        except RuntimeError:
            current = emulator.screencap_bgr()
            retry_match = _find_battle_details_button(current)
            if open_attempt == 0 and retry_match is not None:
                bx, by, _ = retry_match
                img = current
                logger.warning("Battle Details did not open on first tap; retrying once")
                continue
            raise
    if top_img is None:
        raise RuntimeError("Battle Details did not open")

    # Already at top when BD opens — no scroll needed
    top_path = outdir / f'{prefix}_top.png'
    cv2.imwrite(str(top_path), top_img)

    # Small scroll down (less than half screen) to reveal remaining heroes
    emulator.swipe(360, 800, 360, 500, 320)
    time.sleep(0.15)

    bot_path = outdir / f'{prefix}_bot.png'
    emulator.screencap(str(bot_path))

    emulator.back()
    report_bottom_frame = _wait_for_report_bottom(emulator)
    if return_frame_out is not None:
        return_frame_out[:] = [report_bottom_frame]

    return {
        "bd_top": str(top_path),
        "bd_bot": str(bot_path),
    }


def capture_report_stats(
    emulator: WosEmulator,
    outdir: Path,
    prefix: str = "report",
    debug: bool = False,
    initial_frame: np.ndarray | None = None,
) -> dict[str, str]:
    """After returning from Battle Details at report bottom, frame troop slots + stats."""
    outdir.mkdir(parents=True, exist_ok=True)
    stats_path = _capture_stats_with_retries(
        emulator,
        outdir,
        prefix,
        debug=debug,
        max_attempts=_STATS_CAPTURE_MAX_ATTEMPTS,
        initial_frame=initial_frame,
    )
    return {"report_stats": stats_path}


def capture_full_report(
    emulator: WosEmulator,
    outdir: Path,
    debug: bool = False,
    battle_details_ready: Callable[[dict[str, str]], None] | None = None,
    long_screenshot_path: str | Path | None = None,
) -> dict[str, str | bool]:
    """Capture all 4 screenshots for a single report."""
    started = time.monotonic()
    outdir.mkdir(parents=True, exist_ok=True)

    logger.info("Capturing battle report top and bottom to %s", outdir)
    report_data = capture_report(
        emulator,
        outdir,
        debug=debug,
        long_screenshot_path=long_screenshot_path,
    )

    logger.info("Capturing battle details to %s", outdir)
    report_bottom_frame = cv2.imread(report_data["report_bottom"])
    returned_frames: list[np.ndarray] = []
    bd_data = capture_battle_details(
        emulator,
        outdir,
        debug=debug,
        initial_frame=report_bottom_frame,
        return_frame_out=returned_frames,
    )
    if battle_details_ready is not None:
        battle_details_ready(bd_data)

    logger.info("Capturing framed report stats to %s", outdir)
    stats_data = capture_report_stats(
        emulator,
        outdir,
        debug=debug,
        initial_frame=returned_frames[0] if returned_frames else None,
    )

    logger.info("Captured full battle-report image set in %.2fs", time.monotonic() - started)
    return report_data | bd_data | stats_data
