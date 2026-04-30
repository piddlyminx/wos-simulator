#!/usr/bin/env python3
"""Template matching helpers for WOS report anchors."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


@dataclass
class Match:
    __slots__ = ("x","y","w","h","score")
    def __init__(self, x:int, y:int, w:int, h:int, score:float):
        self.x=x; self.y=y; self.w=w; self.h=h; self.score=score
    def __repr__(self):
        return f"Match(x={self.x}, y={self.y}, w={self.w}, h={self.h}, score={self.score:.4f})"


def match_template(img_bgr: np.ndarray, tpl_bgr: np.ndarray, *, method=cv2.TM_CCOEFF_NORMED) -> Match:
    """Return best match location (top-left) and score."""
    img = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    tpl = cv2.cvtColor(tpl_bgr, cv2.COLOR_BGR2GRAY)

    res = cv2.matchTemplate(img, tpl, method)
    min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(res)

    if method in (cv2.TM_SQDIFF, cv2.TM_SQDIFF_NORMED):
        loc = min_loc
        score = 1.0 - float(min_val)
    else:
        loc = max_loc
        score = float(max_val)

    h, w = tpl.shape[:2]
    return Match(x=int(loc[0]), y=int(loc[1]), w=int(w), h=int(h), score=score)


def load_tpl(path: str | Path) -> np.ndarray:
    tpl = cv2.imread(str(path))
    if tpl is None:
        raise FileNotFoundError(path)
    return tpl
