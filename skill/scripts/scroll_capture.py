"""Generic full-length screenshot capture for vertically scrollable WOS screens."""

from __future__ import annotations

import itertools
import os
import re
import time
from pathlib import Path
from typing import Protocol

import cv2
import numpy as np

_STABLE_MEAN_THRESHOLD = 1.5
_MAX_ALIGNMENT_ERROR = 24.0
_MAX_EDGE_MISMATCH = 0.50
_LOW_ALIGNMENT_ERROR = 2.5
_MAX_LOW_ERROR_EDGE_MISMATCH = 0.60
_MAX_TEXT_ALIGNMENT_ERROR = 8.0
_MAX_TEXT_EDGE_MISMATCH = 0.60
_NEAR_EXACT_ALIGNMENT_ERROR = 0.10
_TEXT_ANCHOR_SCALE = 1.5


class ScrollableEmulator(Protocol):
    def screencap_bgr(self) -> np.ndarray: ...

    def swipe(self, x1: int, y1: int, x2: int, y2: int, dur_ms: int) -> None: ...


def _mean_frame_delta(first: np.ndarray, second: np.ndarray) -> float:
    if first.shape != second.shape:
        return float("inf")
    return float(np.mean(cv2.absdiff(first, second)))


def _scroll_position_delta(first: np.ndarray, second: np.ndarray) -> float:
    """Compare scroll position while ignoring small animated screen regions."""
    if first.shape != second.shape:
        return float("inf")
    height, width = first.shape[:2]
    x1 = round(width * 0.08)
    x2 = max(x1 + 1, round(width * 0.86))
    first_gray = cv2.cvtColor(first[:, x1:x2], cv2.COLOR_BGR2GRAY)
    second_gray = cv2.cvtColor(second[:, x1:x2], cv2.COLOR_BGR2GRAY)
    row_error = np.mean(cv2.absdiff(first_gray, second_gray), axis=1)
    sample_size = max(1, round(height * 0.90))
    return float(np.mean(np.partition(row_error, sample_size - 1)[:sample_size]))


def _content_position_delta(
    first: np.ndarray,
    second: np.ndarray,
    content_bounds: tuple[int, int] | None,
) -> float:
    if content_bounds is None:
        return _scroll_position_delta(first, second)
    content_top, content_bottom = content_bounds
    return _scroll_position_delta(
        first[content_top:content_bottom],
        second[content_top:content_bottom],
    )


def estimate_signed_vertical_motion(
    first: np.ndarray,
    second: np.ndarray,
    *,
    content_bounds: tuple[int, int] | None = None,
) -> tuple[int, float]:
    """Return signed vertical translation; positive means downward document progress."""
    if first.shape != second.shape:
        raise ValueError(
            f"Cannot compare frames with different shapes: {first.shape} != {second.shape}"
        )
    content_top, content_bottom = content_bounds or (0, first.shape[0])
    first_content = first[content_top:content_bottom]
    second_content = second[content_top:content_bottom]
    unchanged_delta = (
        _scroll_position_delta(first_content, second_content)
        if content_bounds is None
        else _mean_frame_delta(first_content, second_content)
    )
    if unchanged_delta <= _STABLE_MEAN_THRESHOLD:
        return 0, 0.0

    # Keep every vertical row. These screens contain many nearly identical
    # cards, and vertical downsampling aliases distinct card boundaries.
    forward_shift, forward_score = estimate_vertical_scroll(
        first_content,
        second_content,
        min_shift=1,
    )
    reverse_shift, reverse_score = estimate_vertical_scroll(
        second_content,
        first_content,
        min_shift=1,
    )
    if forward_score <= reverse_score:
        return forward_shift, forward_score
    return -reverse_shift, reverse_score


def estimate_vertical_scroll(
    previous: np.ndarray,
    current: np.ndarray,
    *,
    ignore_fixed_chrome: bool = False,
    min_shift: int | None = None,
    expected_shift: int | None = None,
    prior_weight: float = 0.0,
) -> tuple[int, float]:
    """Return the document-pixel advance between consecutive viewports."""
    if previous.shape != current.shape:
        raise ValueError(
            f"Cannot stitch frames with different shapes: {previous.shape} != {current.shape}"
        )

    height, width = previous.shape[:2]
    # The capture gesture is deliberately short enough to retain substantial
    # overlap. Refuse alignments that would be guessing across a large gap.
    min_overlap = max(24, round(height * 0.20))
    min_shift = min_shift or max(1, round(height * 0.03))
    max_shift = height - min_overlap
    if min_shift > max_shift:
        raise ValueError(
            f"Scrollable content viewport is too short to stitch: {height}px"
        )

    x1 = round(width * 0.08)
    x2 = max(x1 + 1, round(width * 0.86))
    previous_gray = cv2.cvtColor(previous[:, x1:x2], cv2.COLOR_BGR2GRAY)
    current_gray = cv2.cvtColor(current[:, x1:x2], cv2.COLOR_BGR2GRAY)
    target_width = min(180, previous_gray.shape[1])
    if target_width < previous_gray.shape[1]:
        previous_gray = cv2.resize(
            previous_gray,
            (target_width, height),
            interpolation=cv2.INTER_AREA,
        )
        current_gray = cv2.resize(
            current_gray,
            (target_width, height),
            interpolation=cv2.INTER_AREA,
        )
    previous_edges = cv2.Canny(previous_gray, 40, 100)
    current_edges = cv2.Canny(current_gray, 40, 100)

    best_shift = min_shift
    best_score = float("inf")
    best_rank = float("inf")
    for shift in range(min_shift, max_shift + 1):
        row_error = np.mean(
            cv2.absdiff(previous_gray[shift:], current_gray[: height - shift]),
            axis=1,
        )
        if ignore_fixed_chrome:
            # Fixed headers and footers do not obey the document translation.
            # Use the best-aligned half of the rows while locating the viewport.
            sample_size = max(1, len(row_error) // 2)
            score = float(
                np.mean(np.partition(row_error, sample_size - 1)[:sample_size])
            )
        else:
            score = float(np.mean(row_error))
        if ignore_fixed_chrome or expected_shift is None:
            rank = score
        else:
            previous_overlap_edges = previous_edges[shift:]
            current_overlap_edges = current_edges[: height - shift]
            either_edge = cv2.bitwise_or(
                previous_overlap_edges,
                current_overlap_edges,
            )
            edge_count = int(np.count_nonzero(either_edge))
            edge_mismatch = (
                float(
                    np.count_nonzero(
                        cv2.bitwise_xor(
                            previous_overlap_edges,
                            current_overlap_edges,
                        )
                    )
                    / edge_count
                )
                if edge_count >= 24
                else float("inf")
            )
            rank = edge_mismatch + prior_weight * abs(shift - expected_shift) / height
        if (rank, score) < (best_rank, best_score):
            best_shift = shift
            best_score = score
            best_rank = rank

    return best_shift, best_score


def _unique_text_anchors(
    occurrences: dict[str, list[tuple[float, float]]],
) -> dict[str, tuple[float, float]]:
    return {
        token: positions[0]
        for token, positions in occurrences.items()
        if len(positions) == 1
    }


def _normalised_anchor_tokens(text: str) -> list[str]:
    return [
        token
        for word in text.casefold().split()
        if len(token := re.sub(r"[^\w]+", "", word)) >= 4
    ]


def _tesseract_text_anchors(
    frame: np.ndarray,
) -> dict[str, tuple[float, float]]:
    try:
        import pytesseract
    except ImportError:
        return {}

    _height, width = frame.shape[:2]
    # Side icons and notification badges can dominate sparse-text OCR. The
    # central band retains list labels and metadata while excluding that noise.
    x1 = round(width * 0.20)
    x2 = max(x1 + 1, round(width * 0.90))
    image = cv2.resize(
        frame[:, x1:x2],
        None,
        fx=_TEXT_ANCHOR_SCALE,
        fy=_TEXT_ANCHOR_SCALE,
        interpolation=cv2.INTER_CUBIC,
    )
    try:
        data = pytesseract.image_to_data(
            image,
            config="--psm 11",
            output_type=pytesseract.Output.DICT,
        )
    except (OSError, pytesseract.TesseractError):
        return {}

    occurrences: dict[str, list[tuple[float, float]]] = {}
    for text, confidence, left, top, token_width, token_height in zip(
        data["text"],
        data["conf"],
        data["left"],
        data["top"],
        data["width"],
        data["height"],
    ):
        tokens = _normalised_anchor_tokens(text)
        if not tokens or float(confidence) < 40:
            continue
        centre_x = x1 + (float(left) + float(token_width) / 2) / _TEXT_ANCHOR_SCALE
        centre_y = (float(top) + float(token_height) / 2) / _TEXT_ANCHOR_SCALE
        for token in tokens:
            occurrences.setdefault(token, []).append((centre_x, centre_y))

    return _unique_text_anchors(occurrences)


def _rapid_text_anchors(frame: np.ndarray) -> dict[str, tuple[float, float]]:
    """Use bundled RapidOCR when the external Tesseract executable is absent."""
    try:
        from ocr import get_rapid_ocr
    except ImportError:
        return {}

    _height, width = frame.shape[:2]
    x1 = round(width * 0.20)
    x2 = max(x1 + 1, round(width * 0.90))
    try:
        lines, _elapsed = get_rapid_ocr()(frame[:, x1:x2])
    except (ImportError, OSError, RuntimeError, ValueError):
        # OCR only disambiguates otherwise plausible pixel alignments. Failure
        # to load an optional engine must not prevent the pixel-only fallback.
        return {}

    occurrences: dict[str, list[tuple[float, float]]] = {}
    for box, text, confidence in lines:
        tokens = _normalised_anchor_tokens(text)
        if not tokens or float(confidence) < 0.40:
            continue
        xs = [float(point[0]) for point in box]
        ys = [float(point[1]) for point in box]
        centre = (x1 + float(np.mean(xs)), float(np.mean(ys)))
        for token in tokens:
            occurrences.setdefault(token, []).append(centre)
    return _unique_text_anchors(occurrences)


def _text_anchors(frame: np.ndarray) -> dict[str, tuple[float, float]]:
    """Return unique OCR tokens and their centres for ambiguous repeated content."""
    return _tesseract_text_anchors(frame) or _rapid_text_anchors(frame)


def _shift_from_text_anchors(
    previous: dict[str, tuple[float, float]],
    current: dict[str, tuple[float, float]],
    *,
    width: int,
    min_shift: int,
    max_shift: int,
) -> int | None:
    """Find a vertical translation supported by multiple unique text anchors."""
    max_horizontal_drift = max(6, round(width * 0.05))
    deltas = [
        previous[token][1] - current[token][1]
        for token in previous.keys() & current.keys()
        if abs(previous[token][0] - current[token][0]) <= max_horizontal_drift
        and min_shift <= previous[token][1] - current[token][1] <= max_shift
    ]
    if len(deltas) < 2:
        return None

    clusters = [
        [candidate for candidate in deltas if abs(candidate - centre) <= 3]
        for centre in deltas
    ]
    cluster = max(clusters, key=lambda values: (len(values), -np.std(values)))
    if len(cluster) < 2 or len(cluster) * 2 < len(deltas):
        return None
    return round(float(np.median(cluster)))


def _alignment_mean_error(
    previous: np.ndarray,
    current: np.ndarray,
    shift: int,
) -> float:
    height, width = previous.shape[:2]
    if not 0 < shift < height:
        return float("inf")
    x1 = round(width * 0.08)
    x2 = max(x1 + 1, round(width * 0.86))
    return float(
        np.mean(
            cv2.absdiff(
                previous[shift:, x1:x2],
                current[: height - shift, x1:x2],
            )
        )
    )


def _subpixel_alignment_mean_error(
    previous: np.ndarray,
    current: np.ndarray,
    shift: float,
) -> float:
    """Compare overlap when the scroll position lies between raster rows."""
    height, width = previous.shape[:2]
    base_shift = int(np.floor(shift))
    fraction = shift - base_shift
    if fraction < 1e-6:
        return _alignment_mean_error(previous, current, base_shift)
    if base_shift < 0 or base_shift + 1 >= height:
        return float("inf")

    overlap_height = height - base_shift - 1
    x1 = round(width * 0.08)
    x2 = max(x1 + 1, round(width * 0.86))
    interpolated = cv2.addWeighted(
        previous[base_shift : base_shift + overlap_height, x1:x2],
        1.0 - fraction,
        previous[base_shift + 1 : base_shift + overlap_height + 1, x1:x2],
        fraction,
        0,
    )
    return float(np.mean(cv2.absdiff(interpolated, current[:overlap_height, x1:x2])))


def _refine_subpixel_shift(
    previous: np.ndarray,
    current: np.ndarray,
    approximate_shift: int,
    *,
    min_shift: int,
    max_shift: int,
) -> tuple[float, float]:
    candidates = [
        approximate_shift + eighths / 8
        for eighths in range(-8, 9)
        if min_shift <= approximate_shift + eighths / 8 <= max_shift
    ]
    return min(
        (
            (shift, _subpixel_alignment_mean_error(previous, current, shift))
            for shift in candidates
        ),
        key=lambda item: (item[1], abs(item[0] - approximate_shift)),
    )


def _refine_text_shift(
    previous: np.ndarray,
    current: np.ndarray,
    approximate_shift: int,
    *,
    min_shift: int,
    max_shift: int,
) -> tuple[int, float]:
    candidates = range(
        max(min_shift, approximate_shift - 4),
        min(max_shift, approximate_shift + 4) + 1,
    )
    return min(
        (
            (shift, _alignment_mean_error(previous, current, shift))
            for shift in candidates
        ),
        key=lambda item: item[1],
    )


def _consistent_scroll_shifts(content_frames: list[np.ndarray]) -> list[int]:
    if len(content_frames) < 2:
        return []
    height = content_frames[0].shape[0]
    width = content_frames[0].shape[1]
    min_shift = 1
    max_shift = height - max(24, round(height * 0.20))
    anchor_cache: dict[int, dict[str, tuple[float, float]]] = {}
    shifts: list[int] = []
    for index, (previous, current) in enumerate(itertools.pairwise(content_frames)):
        shift, score = estimate_vertical_scroll(previous, current, min_shift=min_shift)
        text_supported = False
        if score > _NEAR_EXACT_ALIGNMENT_ERROR:
            for frame_index in (index, index + 1):
                if frame_index not in anchor_cache:
                    anchor_cache[frame_index] = _text_anchors(
                        content_frames[frame_index]
                    )
            text_shift = _shift_from_text_anchors(
                anchor_cache[index],
                anchor_cache[index + 1],
                width=width,
                min_shift=min_shift,
                max_shift=max_shift,
            )
            if text_shift is not None:
                shift, score = _refine_text_shift(
                    previous,
                    current,
                    text_shift,
                    min_shift=min_shift,
                    max_shift=max_shift,
                )
                text_supported = True
        _, subpixel_score = _refine_subpixel_shift(
            previous,
            current,
            shift,
            min_shift=min_shift,
            max_shift=max_shift,
        )
        score = subpixel_score if text_supported else min(score, subpixel_score)
        edge_mismatch = _alignment_edge_mismatch(previous, current, shift)
        if not _alignment_is_reliable(
            score,
            edge_mismatch,
            text_supported=text_supported,
        ):
            raise RuntimeError(
                "Could not establish a reliable scrolling overlap "
                f"(mean pixel error={score:.2f}, edge mismatch={edge_mismatch:.3f})"
            )
        shifts.append(shift)
    return shifts


def _alignment_is_reliable(
    mean_error: float,
    edge_mismatch: float,
    *,
    text_supported: bool,
) -> bool:
    """Require compatible joint evidence instead of independent hard cutoffs."""
    max_mean_error = (
        _MAX_TEXT_ALIGNMENT_ERROR if text_supported else _MAX_ALIGNMENT_ERROR
    )
    max_edge_mismatch = (
        _MAX_TEXT_EDGE_MISMATCH
        if text_supported or mean_error <= _LOW_ALIGNMENT_ERROR
        else _MAX_EDGE_MISMATCH
    )
    return mean_error <= max_mean_error and edge_mismatch <= max_edge_mismatch


def _alignment_edge_mismatch(
    previous: np.ndarray,
    current: np.ndarray,
    shift: int,
) -> float:
    """Measure whether distinctive edges support a proposed forward overlap."""
    height, width = previous.shape[:2]
    if not 0 < shift < height:
        return float("inf")
    x1 = round(width * 0.08)
    x2 = max(x1 + 1, round(width * 0.86))
    previous_gray = cv2.cvtColor(previous[:, x1:x2], cv2.COLOR_BGR2GRAY)
    current_gray = cv2.cvtColor(current[:, x1:x2], cv2.COLOR_BGR2GRAY)
    previous_edges = cv2.Canny(previous_gray, 40, 100)[shift:]
    current_edges = cv2.Canny(current_gray, 40, 100)[: height - shift]
    either_edge = cv2.bitwise_or(previous_edges, current_edges)
    edge_count = int(np.count_nonzero(either_edge))
    if edge_count < 24:
        return float("inf")
    differing_edges = cv2.bitwise_xor(previous_edges, current_edges)
    return float(np.count_nonzero(differing_edges) / edge_count)


def detect_content_bounds(previous: np.ndarray, current: np.ndarray) -> tuple[int, int]:
    """Infer the vertically moving viewport while excluding fixed top/bottom chrome."""
    if previous.shape != current.shape:
        raise ValueError(
            f"Cannot compare frames with different shapes: {previous.shape} != {current.shape}"
        )

    height, width = previous.shape[:2]
    x1 = round(width * 0.08)
    x2 = max(x1 + 1, round(width * 0.86))
    previous_gray = cv2.cvtColor(previous[:, x1:x2], cv2.COLOR_BGR2GRAY)
    current_gray = cv2.cvtColor(current[:, x1:x2], cv2.COLOR_BGR2GRAY)
    row_error = np.mean(cv2.absdiff(previous_gray, current_gray), axis=1)

    window = max(3, round(height * 0.015))
    if window % 2 == 0:
        window += 1
    smooth = np.convolve(row_error, np.ones(window) / window, mode="same")
    moving = smooth > max(3.0, float(np.percentile(smooth, 10)) + 2.0)

    # Bridge blank rows within the scrolling panel, then choose its longest
    # contiguous moving band. Fixed top/bottom chrome remains unchanged.
    gap = max(3, round(height * 0.04))
    closed = cv2.morphologyEx(
        moving.astype(np.uint8).reshape(-1, 1),
        cv2.MORPH_CLOSE,
        np.ones((gap, 1), dtype=np.uint8),
    ).ravel()
    signed = closed.astype(np.int8)
    starts = np.flatnonzero(np.diff(np.r_[np.int8(0), signed]) == 1)
    ends = np.flatnonzero(np.diff(np.r_[signed, np.int8(0)]) == -1)
    if not len(starts):
        raise RuntimeError(
            "Could not infer a scrolling viewport from the captured frames"
        )

    start, end = max(zip(starts, ends), key=lambda pair: pair[1] - pair[0])
    raw_moving = row_error > max(3.0, float(np.percentile(row_error, 10)) + 2.0)
    active_rows = np.flatnonzero(raw_moving[int(start) : int(end) + 1]) + int(start)
    if not len(active_rows):
        raise RuntimeError("Detected moving viewport contains no changed image rows")
    content_top = int(active_rows[0])
    content_bottom = min(height, int(active_rows[-1]) + 1)
    if content_bottom - content_top < height * 0.25:
        raise RuntimeError(
            "Detected scrolling viewport is implausibly short: "
            f"({content_top}, {content_bottom}) in a {height}px frame"
        )

    # A translucent fixed overlay can change at the same screen coordinates
    # because moving content remains visible beneath it. Refine the coarse
    # band by finding rows that agree after applying the document translation.
    coarse_previous = previous[content_top:content_bottom]
    coarse_current = current[content_top:content_bottom]
    shift, score = estimate_vertical_scroll(
        coarse_previous,
        coarse_current,
        min_shift=1,
    )
    overlap_height = coarse_previous.shape[0] - shift
    if score <= _MAX_ALIGNMENT_ERROR and overlap_height >= 24:
        crop_width = coarse_previous.shape[1]
        crop_x1 = round(crop_width * 0.08)
        crop_x2 = max(crop_x1 + 1, round(crop_width * 0.86))
        aligned_previous = cv2.cvtColor(
            coarse_previous[shift:, crop_x1:crop_x2],
            cv2.COLOR_BGR2GRAY,
        )
        aligned_current = cv2.cvtColor(
            coarse_current[:overlap_height, crop_x1:crop_x2],
            cv2.COLOR_BGR2GRAY,
        )
        aligned_error = np.mean(
            cv2.absdiff(aligned_previous, aligned_current),
            axis=1,
        )
        window = 5
        smoothed_error = np.convolve(
            aligned_error,
            np.ones(window) / window,
            mode="same",
        )
        # A bottom overlay appears as a short terminal mismatch after a long
        # accurately translated region. Only inspect the tail so text or icons
        # elsewhere cannot shorten the viewport.
        tail_length = max(24, round(height * 0.06))
        tail_start = max(0, len(smoothed_error) - tail_length)
        mismatched = smoothed_error > max(8.0, score * 1.5)
        starts = np.flatnonzero(
            np.diff(np.r_[np.int8(0), mismatched.astype(np.int8)]) == 1
        )
        ends = np.flatnonzero(
            np.diff(np.r_[mismatched.astype(np.int8), np.int8(0)]) == -1
        )
        terminal_runs = [
            (int(start), int(end))
            for start, end in zip(starts, ends)
            if start >= tail_start and end - start >= 2
        ]
        if terminal_runs:
            overlay_start = terminal_runs[0][0]
            refined_bottom = content_top + overlay_start + shift
            removed = content_bottom - refined_bottom
            if 2 <= removed <= tail_length:
                content_bottom = refined_bottom
    # Boundary antialiasing and translucent edge pixels do not translate like
    # document pixels. Keep those single rows with the fixed first/last frame.
    if content_bottom - content_top > 2:
        content_top += 1
        content_bottom -= 1
    return content_top, content_bottom


def _append_forward_samples(
    frames: list[np.ndarray],
    samples: list[np.ndarray],
    content_bounds: tuple[int, int],
) -> int:
    """Keep only samples that advance and overlap the current stitched tail."""
    content_top, content_bottom = content_bounds
    appended = 0
    for sample in samples:
        previous_content = frames[-1][content_top:content_bottom]
        current_content = sample[content_top:content_bottom]
        if (
            _mean_frame_delta(previous_content, current_content)
            <= _STABLE_MEAN_THRESHOLD
        ):
            continue
        shift, score = estimate_vertical_scroll(previous_content, current_content)
        edge_mismatch = _alignment_edge_mismatch(
            previous_content,
            current_content,
            shift,
        )
        if score > _MAX_ALIGNMENT_ERROR or edge_mismatch > _MAX_EDGE_MISMATCH:
            continue
        frames.append(sample)
        appended += 1
    return appended


def stitch_scrolling_frames(
    frames: list[np.ndarray],
    *,
    content_bounds: tuple[int, int],
    shifts: list[int] | None = None,
) -> np.ndarray:
    """Stitch overlapping vertical frames without duplicating overlap rows."""
    if not frames:
        raise ValueError("Cannot stitch an empty frame list")
    if any(frame.shape != frames[0].shape for frame in frames):
        raise ValueError("Cannot stitch frames with different dimensions")

    height = frames[0].shape[0]
    content_top, content_bottom = content_bounds
    if not 0 <= content_top < content_bottom <= height:
        raise ValueError(
            f"Invalid content bounds ({content_top}, {content_bottom}) for {height}px frame"
        )

    content_frames = [frame[content_top:content_bottom] for frame in frames]
    if shifts is not None and len(shifts) != len(content_frames) - 1:
        raise ValueError("Scroll shift count must be one fewer than frame count")
    chunks = [frames[0][:content_top], content_frames[0]]
    previous = content_frames[0]
    last_frame = frames[0]
    for index, (frame, current) in enumerate(zip(frames[1:], content_frames[1:])):
        if _mean_frame_delta(previous, current) <= _STABLE_MEAN_THRESHOLD:
            continue
        shift, score = (
            (shifts[index], 0.0)
            if shifts is not None
            else estimate_vertical_scroll(previous, current)
        )
        edge_mismatch = _alignment_edge_mismatch(previous, current, shift)
        max_edge_mismatch = (
            _MAX_TEXT_EDGE_MISMATCH if shifts is not None else _MAX_EDGE_MISMATCH
        )
        if score > _MAX_ALIGNMENT_ERROR or edge_mismatch > max_edge_mismatch:
            raise RuntimeError(
                "Could not align consecutive screenshots reliably "
                f"(mean pixel error={score:.2f}, edge mismatch={edge_mismatch:.3f})"
            )
        chunks.append(current[current.shape[0] - shift :])
        previous = current
        last_frame = frame

    chunks.append(last_frame[content_bottom:])
    return np.concatenate(chunks, axis=0)


def save_stitched_screenshot(image: np.ndarray, output_path: str | Path) -> str:
    path = Path(output_path).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    suffix = path.suffix or ".png"
    temp_path = path.with_name(f".{path.stem}.{os.getpid()}.tmp{suffix}")
    try:
        if not cv2.imwrite(str(temp_path), image):
            raise RuntimeError(f"Failed to write scrolling screenshot: {path}")
        temp_path.replace(path)
    finally:
        temp_path.unlink(missing_ok=True)
    return str(path)


def _swipe(
    emulator: ScrollableEmulator,
    frame: np.ndarray,
    *,
    toward_start: bool,
    settle_seconds: float,
    wait_until_settled: bool = True,
) -> np.ndarray:
    height, width = frame.shape[:2]
    x = round(360 * width / 720)
    upper = round(720 * height / 1280)
    lower = round(920 * height / 1280)
    y1, y2 = (upper, lower) if toward_start else (lower, upper)
    emulator.swipe(x, y1, x, y2, 1000)
    if not settle_seconds:
        return emulator.screencap_bgr()

    if not wait_until_settled:
        # Match the report-capture cadence. Capturing promptly is what keeps
        # enough overlap on lists with sensitive inertial scrolling.
        time.sleep(0.2)
        return emulator.screencap_bgr()

    return _capture_until_settled(emulator, settle_seconds=settle_seconds)[-1]


def _capture_until_settled(
    emulator: ScrollableEmulator,
    *,
    settle_seconds: float,
    content_bounds: tuple[int, int] | None = None,
) -> list[np.ndarray]:
    """Capture promptly for overlap, then sample until scrolling has settled."""
    time.sleep(0.2)
    samples = [emulator.screencap_bgr()]
    candidate = samples[0]
    stable_samples = 0
    motion: list[tuple[int, float]] = []
    max_samples = 60
    for _ in range(max_samples):
        time.sleep(0.08)
        following = emulator.screencap_bgr()
        samples.append(following)
        shift, score = estimate_signed_vertical_motion(
            candidate,
            following,
            content_bounds=content_bounds,
        )
        motion.append((shift, score))
        stable_samples = stable_samples + 1 if abs(shift) <= 2 else 0
        if stable_samples >= 2:
            # Motion can stop before the application has redrawn the row that
            # received the swipe. Give touch feedback time to clear, then keep
            # the post-release frame only if the scroll position stayed put.
            time.sleep(settle_seconds)
            released = emulator.screencap_bgr()
            samples.append(released)
            release_shift, release_score = estimate_signed_vertical_motion(
                following,
                released,
                content_bounds=content_bounds,
            )
            motion.append((release_shift, release_score))
            if abs(release_shift) <= 2:
                return samples
            candidate = released
            stable_samples = 0
            continue
        candidate = following
    raise RuntimeError(
        f"Scrolling did not settle after {max_samples} samples "
        f"(motion={[(shift, round(score, 3)) for shift, score in motion]})"
    )


def _scroll_to_start(
    emulator: ScrollableEmulator,
    *,
    max_scrolls: int,
    settle_seconds: float,
    stable_swipes: int,
) -> tuple[np.ndarray, int]:
    current = emulator.screencap_bgr()
    stable = 0
    swipe_count = 0
    motion: list[tuple[int, float, float]] = []
    while swipe_count < max_scrolls:
        before = current
        height, width = before.shape[:2]
        x = round(360 * width / 720)
        upper = round(260 * height / 1280)
        lower = round(1100 * height / 1280)

        # Rewinding does not need overlap between screenshots. Send several
        # long, fast gestures before checking, then use one gesture for the
        # confirmation after the first no-progress result.
        burst_size = 1 if stable else min(4, max_scrolls - swipe_count)
        for _ in range(burst_size):
            emulator.swipe(x, upper, x, lower, 120)
        swipe_count += burst_size

        following = (
            _capture_until_settled(
                emulator,
                settle_seconds=settle_seconds,
            )[-1]
            if settle_seconds
            else emulator.screencap_bgr()
        )
        shift, score = estimate_signed_vertical_motion(before, following)
        position_delta = _scroll_position_delta(before, following)
        motion.append((shift, score, position_delta))
        if position_delta <= _STABLE_MEAN_THRESHOLD:
            stable += 1
            if stable >= stable_swipes:
                return following, swipe_count
        else:
            stable = 0
        current = following
    raise RuntimeError(
        f"Top of scrollable region was not reached after {max_scrolls} swipes"
    )


def capture_scrolling_screenshot(
    emulator: ScrollableEmulator,
    output_path: str | Path,
    *,
    max_scrolls: int = 200,
    content_bounds: tuple[int, int] | None = None,
    settle_seconds: float = 0.25,
    stable_swipes: int = 2,
) -> dict[str, object]:
    """Capture the current screen's entire vertical scroll region from top to bottom."""
    if max_scrolls < 1:
        raise ValueError("max_scrolls must be at least 1")
    if stable_swipes < 1:
        raise ValueError("stable_swipes must be at least 1")

    top_frame, top_swipes = _scroll_to_start(
        emulator,
        max_scrolls=max_scrolls,
        settle_seconds=settle_seconds,
        stable_swipes=stable_swipes,
    )
    frames = [top_frame]
    previous = top_frame
    resolved_bounds = content_bounds
    bottom_stable = 0
    bottom_swipes = 0
    bottom_position_deltas: list[float] = []

    for step in range(1, max_scrolls + 1):
        before = previous
        height, width = before.shape[:2]
        emulator.swipe(
            round(360 * width / 720),
            round(920 * height / 1280),
            round(360 * width / 720),
            round(720 * height / 1280),
            1000,
        )
        current = (
            _capture_until_settled(
                emulator,
                settle_seconds=settle_seconds,
                content_bounds=resolved_bounds,
            )[-1]
            if settle_seconds
            else emulator.screencap_bgr()
        )
        bottom_swipes = step
        position_delta = _content_position_delta(
            before,
            current,
            resolved_bounds,
        )
        bottom_position_deltas.append(position_delta)
        if position_delta <= _STABLE_MEAN_THRESHOLD:
            bottom_stable += 1
            if bottom_stable >= stable_swipes:
                break
            previous = current
            continue

        bottom_stable = 0
        if resolved_bounds is None:
            resolved_bounds = detect_content_bounds(before, current)
            safe_bottom = resolved_bounds[1] - max(1, round(height * 0.01))
            resolved_bounds = (resolved_bounds[0], safe_bottom)
        frames.append(current)
        previous = current
    else:
        raise RuntimeError(
            f"Bottom of scrollable region was not reached after {max_scrolls} swipes"
        )

    if resolved_bounds is None:
        resolved_bounds = (0, frames[0].shape[0])

    content_top, content_bottom = resolved_bounds
    scroll_shifts = _consistent_scroll_shifts(
        [frame[content_top:content_bottom] for frame in frames]
    )
    stitched = stitch_scrolling_frames(
        frames,
        content_bounds=resolved_bounds,
        shifts=scroll_shifts,
    )
    path = save_stitched_screenshot(stitched, output_path)
    return {
        "path": path,
        "frame_count": len(frames),
        "width": int(stitched.shape[1]),
        "height": int(stitched.shape[0]),
        "content_bounds": list(resolved_bounds),
        "top_swipes": top_swipes,
        "bottom_swipes": bottom_swipes,
        "median_scroll_shift": (
            round(float(np.median(scroll_shifts))) if scroll_shifts else 0
        ),
        "top_reached": True,
        "bottom_reached": True,
    }
