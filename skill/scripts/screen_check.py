#!/usr/bin/env python3
"""Screen state detection for Whiteout Survival."""
import sys
from PIL import Image


def _nav_bar_visible(img) -> bool:
    """Check if the bottom nav bar is visible (not obscured by popup overlay)."""
    w, h = img.size
    nav_y = h - 40  # y=1240 for 1280h — solid blue bar area
    sample_xs = [30, 150, 270, 390, 510]
    match = 0
    for x in sample_xs:
        r, g, b, *_ = img.getpixel((x, nav_y))
        if 70 <= r <= 120 and 105 <= g <= 140 and 160 <= b <= 190:
            match += 1
    return match >= 4


def _is_world_icon(img) -> bool:
    """Check if bottom-right shows the World map icon (warm brown = city view).
    Returns True if we see the World icon (meaning we're in the city).
    Returns False if we see the City/door icon (meaning we're on the world map).
    """
    w, h = img.size
    r, g, b, *_ = img.getpixel((668, h - 50))  # y=1230 for 1280h
    # City view: World icon is warm brown ~(228,184,123)
    # World map: City icon is dark ~(155,91,75)
    return r > 180 and g > 140 and b > 90


def get_screen_state(image_path: str) -> str:
    """Determine the current screen state.
    
    Returns one of:
        'city'      — main city/base view
        'world_map' — world map view  
        'popup'     — a popup/dialog is covering the screen
        'unknown'   — can't determine
    """
    img = Image.open(image_path)
    
    if not _nav_bar_visible(img):
        return "popup"
    
    if _is_world_icon(img):
        return "city"
    else:
        return "world_map"


def is_base_view(image_path: str) -> bool:
    """Check if we're on the main city/base view."""
    return get_screen_state(image_path) == "city"


def is_world_map(image_path: str) -> bool:
    """Check if we're on the world map."""
    return get_screen_state(image_path) == "world_map"


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: screen_check.py <image_path> [state|base|world]")
        sys.exit(1)
    
    path = sys.argv[1]
    check = sys.argv[2] if len(sys.argv) > 2 else "state"
    
    if check == "state":
        state = get_screen_state(path)
        print(state)
        sys.exit(0)
    elif check == "base":
        result = is_base_view(path)
        print("BASE_VIEW" if result else "NOT_BASE_VIEW")
        sys.exit(0 if result else 1)
    elif check == "world":
        result = is_world_map(path)
        print("WORLD_MAP" if result else "NOT_WORLD_MAP")
        sys.exit(0 if result else 1)
