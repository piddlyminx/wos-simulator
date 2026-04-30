"""
navigation.py — Template-based screen detection and navigation for WOS.

Replaces the pixel-sampling approach in screen_check.py with OpenCV template matching.
Additive: screen_check.py is kept intact.

Key semantic note (buttons are OPPOSITE to current screen):
  - city.png (furnace icon) is shown on the WORLD MAP → tap to go to city
  - world.png (world icon)  is shown in the CITY       → tap to go to world map

So:
  city button visible   → state = 'world_map'
  world button visible  → state = 'city'

All navigation functions accept a ``WosEmulator`` instance rather than a raw
``serial: str``.  The emulator object's ``.serial`` is used where low-level ADB
helpers still need it.
"""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import TYPE_CHECKING, Tuple

import difflib

import cv2
import numpy as np
import pytesseract
from PIL import Image as _PILImage

if TYPE_CHECKING:
    from emulator import WosEmulator

_rapid_ocr = None

logger = logging.getLogger(__name__)

# ─── Template paths ────────────────────────────────────────────────────────────
_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"

TEMPLATE_CITY_BUTTON = str(_TEMPLATES_DIR / "nav_city_button.png")   # visible on world map
TEMPLATE_WORLD_BUTTON = str(_TEMPLATES_DIR / "nav_world_button.png")  # visible in city
TEMPLATE_RECONNECT = str(_TEMPLATES_DIR / "nav_reconnect.png")
TEMPLATE_QUIT_DIALOG = str(_TEMPLATES_DIR / "quit_game_confirmation.png")  
TEMPLATE_STATE_MAP_WORLD_BUTTON = str(_TEMPLATES_DIR / "state_map_world_button.png")  # visible on State Map (bottom-right)
TEMPLATE_PETS_BUTTON = str(_TEMPLATES_DIR / "city_pets_button.png")   # visible in city
TEMPLATE_PETS_VERIFY = str(_TEMPLATES_DIR / "pets_beast_cage.png")    # visible on pets screen
TEMPLATE_BEAST_CAGE_BUTTON = str(_TEMPLATES_DIR / "pets_beast_cage.png")          # reuse: beast cage icon on pets screen
TEMPLATE_BEAST_CAGE_VERIFY = str(_TEMPLATES_DIR / "beast_cage_adventure_tab.png")  # Adventure tab in beast cage nav bar
TEMPLATE_PET_LIST_TAB    = str(_TEMPLATES_DIR / "beast_cage_pet_list_tab.png")    # Pet List tab in beast cage nav bar
TEMPLATE_PET_LIST_CARD   = str(_TEMPLATES_DIR / "pet_list_first_card.png")        # First card in pet list popup
TEMPLATE_PET_CHEVRON_RIGHT = str(_TEMPLATES_DIR / "pet_details_chevron_right.png") # Right chevron on pet details page
TEMPLATE_PET_REFINE_TAB      = str(_TEMPLATES_DIR / "pet_details_refine_tab.png")      # Refine tab on pet details page
TEMPLATE_SELECT_COMMON       = str(_TEMPLATES_DIR / "select_common.png")               # Common stone icon (tap right edge to select)
TEMPLATE_SELECT_ADVANCED     = str(_TEMPLATES_DIR / "select_advanced.png")             # Advanced stone icon (tap right edge to select)
TEMPLATE_COMMON_IS_SELECTED  = str(_TEMPLATES_DIR / "common_is_selected.png")          # Verify Common is selected
TEMPLATE_ADVANCED_IS_SELECTED = str(_TEMPLATES_DIR / "advanced_is_selected.png")       # Verify Advanced is selected

KNOWN_PET_NAMES = [
    "Cave Hyena", "Arctic Wolf", "Musk Ox", "Giant Tapir", "Titan Roc",
    "Snow Leopard", "Giant Elk", "Frostscale Chameleon", "Cave Lion",
    "Snow Ape", "Iron Rhino", "Saber-tooth Tiger", "Mammoth", "Frost Gorilla",
]


def _get_rapid_ocr():
    global _rapid_ocr
    if _rapid_ocr is None:
        from ocr import RapidOCR
        _rapid_ocr = RapidOCR()
    return _rapid_ocr


# ─── Exceptions ────────────────────────────────────────────────────────────────
class WosError(Exception):
    pass


class WosReconnectError(WosError):
    """Raised when the reconnect dialog is detected (server connection lost)."""
    pass


class WosNavigationError(WosError):
    """Raised when navigation cannot reach the target state."""
    pass


# ─── Template matching ─────────────────────────────────────────────────────────
def find_template(
    screenshot_bgr: np.ndarray,
    template_path: str,
    threshold: float = 0.85,
    anchor: str = "center",
) -> Tuple[bool, Tuple[int, int]]:
    """
    Find a template in a screenshot using normalised cross-correlation.

    Args:
        anchor: where to return the tap point — 'center' (default) or 'bottom_right'.

    Returns:
        (found, (x, y)) — tap point of the best match region.
        If found is False, (x, y) are (0, 0).
    """
    template = cv2.imread(template_path)
    if template is None:
        raise FileNotFoundError(f"Template not found: {template_path}")

    result = cv2.matchTemplate(screenshot_bgr, template, cv2.TM_CCOEFF_NORMED)
    _, max_val, _, max_loc = cv2.minMaxLoc(result)

    if max_val < threshold:
        return False, (0, 0)

    th, tw = template.shape[:2]
    if anchor == "bottom_right":
        x = max_loc[0] + tw - 1
        y = max_loc[1] + th - 1
    else:
        x = max_loc[0] + tw // 2
        y = max_loc[1] + th // 2
    logger.debug("Template %s matched at (%d,%d) anchor=%s score=%.3f", template_path, x, y, anchor, max_val)
    return True, (x, y)


def _handle_reconnect(emulator: WosEmulator, wait: float = 6.0) -> None:
    """Tap the Reconnect button on the reconnect dialog and wait for the game to reload."""
    logger.info("_handle_reconnect: tapping Reconnect button at (530,760)")
    emulator.tap(530, 760)
    time.sleep(wait)


# ─── Screen state detection ────────────────────────────────────────────────────
def get_screen_state(emulator: WosEmulator, timeout_sec: float | None = None) -> str:
    """
    Determine current WOS screen state via template matching.

    Returns:
        'city'       — we are in the city (world button visible in nav bar)
        'world'  — we are on the world map (city button visible in nav bar)
        'reconnect'  — server reconnect dialog is showing
        'state_map'  — we are on the State Map screen (World button visible bottom-right)
        'unknown'    — none of the templates matched
    """
    img = emulator.screencap_bgr(timeout_sec=timeout_sec)

    # city button visible → we're on the world map
    found, _ = find_template(img, TEMPLATE_CITY_BUTTON)
    if found:
        return "world"

    # world button visible → we're in the city
    found, _ = find_template(img, TEMPLATE_WORLD_BUTTON)
    if found:
        return "city"

    # reconnect dialog
    found, _ = find_template(img, TEMPLATE_RECONNECT)
    if found:
        return "reconnect"

    # state map screen (World button)
    found, _ = find_template(img, TEMPLATE_STATE_MAP_WORLD_BUTTON)
    if found:
        return "state_map"

    return "unknown"


# ─── Navigation ───────────────────────────────────────────────────────────────
def _goto_nav_screen(
    emulator: WosEmulator,
    target: str,
    from_state: str,
    tap_template: str,
    max_attempts: int,
) -> bool:
    """
    Generic city ↔ world-map navigator.

    Loops until `target` state is confirmed, handling reconnect and unknown states.
    When in `from_state`, finds `tap_template` and taps it (fallback: (668, 1255)).
    """
    _FALLBACK = (668, 1255)
    for attempt in range(1, max_attempts + 1):
        state = get_screen_state(emulator)
        logger.info("goto_%s attempt %d/%d: state=%s", target, attempt, max_attempts, state)

        if state == target:
            logger.info("goto_%s: Arrived at destination", target)
            # _dismiss_popups(emulator)  # Ensure no popups are left blocking the screen
            return True

        if state == from_state:
            img = emulator.screencap_bgr()
            found, (cx, cy) = find_template(img, tap_template)
            if not found:
                cx, cy = _FALLBACK
                logger.info("goto_%s: template not found, using fallback (%d,%d)", target, cx, cy)
            else:
                logger.info("goto_%s: tapping at (%d,%d)", target, cx, cy)
            emulator.tap(cx, cy)
            time.sleep(3)

            verified = get_screen_state(emulator)
            logger.info("goto_%s: tapped (%d,%d) → verified=%s", target, cx, cy, verified)
            if verified == target:
                return True
            if verified == "reconnect":
                # Handle reconnect and continue looping
                logger.info("goto_%s: reconnect after tap → auto-reconnecting", target)
                _handle_reconnect(emulator)
                continue
            # Do not hard-fail on transient/blocked states; continue main loop
            continue

        elif state == "reconnect":
            logger.info("goto_%s: reconnect → auto-reconnecting", target)
            _handle_reconnect(emulator)

        elif state == "state_map":
            # State Map cannot be escaped with back — always tap the World button first.
            # Once on the world map the next loop iteration handles reaching any target.
            img = emulator.screencap_bgr()
            found, (cx, cy) = find_template(img, TEMPLATE_STATE_MAP_WORLD_BUTTON)
            if not found:
                cx, cy = (665, 1225)
                logger.info("goto_%s: state_map world button template not found, using fallback (%d,%d)", target, cx, cy)
            else:
                logger.info("goto_%s: state_map → tapping World at (%d,%d)", target, cx, cy)
            emulator.tap(cx, cy)
            time.sleep(3)

        elif state == "unknown":
            logger.info("goto_%s: unknown → pressing back", target)
            emulator.back()
            time.sleep(1)

    raise WosNavigationError(f"Could not navigate to {target} after {max_attempts} attempts")


def goto_world_map(emulator: WosEmulator, max_attempts: int = 10) -> bool:
    """Navigate to the world map from any state."""
    return _goto_nav_screen(emulator, "world", "city", TEMPLATE_WORLD_BUTTON, max_attempts)


def goto_city(emulator: WosEmulator, max_attempts: int = 10) -> bool:
    """Navigate to the city from any state."""
    return _goto_nav_screen(emulator, "city", "world", TEMPLATE_CITY_BUTTON, max_attempts)


def goto_pets(emulator: WosEmulator, max_attempts: int = 10) -> bool:
    """Navigate to the Pets screen from any state.

    Flow:
    1. goto_city(emulator) — ensure we're in city first
    2. Find pets button template in city view
    3. Tap it
    4. Wait 2s
    5. Verify arrival with beastCage template
    6. If verify fails → raise WosNavigationError

    Returns True on success.
    Raises WosReconnectError (propagated from goto_city) if the reconnect dialog appears.
    Raises WosNavigationError if the pets button is not found on the city screen, or if
        the pets screen verify template is not found after tapping.
    """
    # Step 1: ensure we're in the city first
    goto_city(emulator, max_attempts=max_attempts)

    # Step 2: find the pets button on the city screen
    img = emulator.screencap_bgr()
    found, (cx, cy) = find_template(img, TEMPLATE_PETS_BUTTON)
    if not found:
        raise WosNavigationError(
            "goto_pets: pets button template not found on city screen"
        )

    # Step 3: tap it
    logger.info("goto_pets: state=city → tapping pets button at (%d,%d)", cx, cy)
    emulator.tap(cx, cy)

    # Step 4: wait for screen transition
    time.sleep(2)

    # Step 5: verify arrival on pets screen
    img_verify = emulator.screencap_bgr()
    arrived, _ = find_template(img_verify, TEMPLATE_PETS_VERIFY)
    if not arrived:
        raise WosNavigationError(
            "goto_pets: pets screen verify template (beastCage) not found after tapping pets button"
        )

    logger.info("goto_pets: → verified on pets screen")
    return True


def goto_beast_cage(emulator: WosEmulator, max_attempts: int = 10) -> bool:
    """Navigate to the Beast Cage screen from any state.

    Flow:
    1. goto_pets(emulator) — ensure we're on the pets screen first
    2. Find beast cage button (pets_beast_cage.png) on the pets screen
    3. Tap it
    4. Wait 2s
    5. Verify arrival with beast_cage_adventure_tab.png (score ≥ 0.85)
    6. If verify fails → raise WosNavigationError

    Returns True on success.
    Raises WosReconnectError (propagated from goto_pets) if the reconnect dialog appears.
    Raises WosNavigationError if the beast cage button is not found on the pets screen, or
        if the beast cage verify template is not found after tapping.
    """
    # Step 1: ensure we're on the pets screen first
    goto_pets(emulator, max_attempts=max_attempts)

    # Step 2: find the beast cage button on the pets screen
    img = emulator.screencap_bgr()
    found, (cx, cy) = find_template(img, TEMPLATE_BEAST_CAGE_BUTTON)
    if not found:
        raise WosNavigationError(
            "goto_beast_cage: beast cage button template not found on pets screen"
        )

    # Step 3: tap it
    logger.info("goto_beast_cage: state=pets → tapping beast cage button at (%d,%d)", cx, cy)
    emulator.tap(cx, cy)

    # Step 4: wait for screen transition
    time.sleep(2)

    # Step 5: verify arrival on beast cage screen
    img_verify = emulator.screencap_bgr()
    arrived, _ = find_template(img_verify, TEMPLATE_BEAST_CAGE_VERIFY)
    if not arrived:
        raise WosNavigationError(
            "goto_beast_cage: beast cage verify template (adventure tab) not found after tapping"
        )

    logger.info("goto_beast_cage: → verified on beast cage screen")
    return True


def _ocr_pet_name(img_bgr: np.ndarray) -> str:
    """
    OCR the pet name from the top-left of the pet details screen.

    Crops x=40-380, y=25-80, runs Tesseract PSM 7, then fuzzy-matches
    against KNOWN_PET_NAMES.

    Returns the matched pet name, or '' if no match with cutoff 0.4.
    """
    h, w = img_bgr.shape[:2]
    name_crop = img_bgr[25:80, 40:380]

    # Primary: RapidOCR on raw crop (handles white-on-blue text well)
    result, _ = _get_rapid_ocr()(name_crop)
    raw = " ".join(r[1] for r in result) if result else ""
    logger.debug("_ocr_pet_name RapidOCR: %r", raw)

    # Fallback: Tesseract with binary threshold (handles darker/lower-contrast text)
    if not raw:
        gray = cv2.cvtColor(name_crop, cv2.COLOR_BGR2GRAY)
        _, thresh = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY)
        raw = pytesseract.image_to_string(_PILImage.fromarray(thresh), config="--psm 7").strip()
        logger.debug("_ocr_pet_name Tesseract fallback: %r", raw)
    matches = difflib.get_close_matches(raw, KNOWN_PET_NAMES, n=1, cutoff=0.4)
    result = matches[0] if matches else ""
    logger.debug("_ocr_pet_name matched: %r", result)
    return result


def goto_pet(emulator: WosEmulator, pet_name: str, max_attempts: int = 30) -> bool:
    """
    Navigate to a specific pet's details page in the Beast Cage.

    Flow:
    1. goto_beast_cage(emulator)
    2. Template-match + tap the Pet List tab → pet grid popup
    3. Tap the first pet card → land on pet details page
    4. OCR name → fuzzy-match against KNOWN_PET_NAMES
    5. If it matches pet_name → done
    6. If not → tap right chevron, repeat up to max_attempts times

    Returns True on success.
    Raises ValueError if pet_name is not in KNOWN_PET_NAMES.
    Raises WosNavigationError if the pet is not found after cycling through all pets.
    """
    # Normalise and validate
    matches = difflib.get_close_matches(pet_name, KNOWN_PET_NAMES, n=1, cutoff=0.6)
    if not matches:
        raise ValueError(
            f"goto_pet: '{pet_name}' is not a known pet name. "
            f"Known: {KNOWN_PET_NAMES}"
        )
    target = matches[0]
    logger.info("goto_pet: target='%s'", target)

    # Step 1: get to beast cage
    goto_beast_cage(emulator)

    # Step 2: tap Pet List tab
    img = emulator.screencap_bgr()
    found, (cx, cy) = find_template(img, TEMPLATE_PET_LIST_TAB)
    if not found:
        raise WosNavigationError("goto_pet: Pet List tab not found on beast cage screen")
    logger.info("goto_pet: tapping Pet List tab at (%d,%d)", cx, cy)
    emulator.tap(cx, cy)
    time.sleep(1.5)

    # Step 3: tap first pet card in popup
    img = emulator.screencap_bgr()
    found, (cx, cy) = find_template(img, TEMPLATE_PET_LIST_CARD)
    if not found:
        raise WosNavigationError("goto_pet: first pet card not found in pet list popup")
    logger.info("goto_pet: tapping first pet card at (%d,%d)", cx, cy)
    emulator.tap(cx, cy)
    time.sleep(2)

    # Step 4-6: OCR loop — cycle right through pets until we find the target.
    # max_attempts covers 14 pets + buffer for blank transition frames.
    pets_checked = 0
    MAX_PETS = len(KNOWN_PET_NAMES)
    for attempt in range(1, max_attempts + 1):
        img = emulator.screencap_bgr()
        name = _ocr_pet_name(img)
        logger.info("goto_pet attempt %d/%d: OCR='%s'", attempt, max_attempts, name)

        if name == target:
            logger.info("goto_pet: found '%s' on attempt %d", target, attempt)
            return True

        if not name:
            # Transition frame — wait and retry without tapping
            time.sleep(0.5)
            continue

        pets_checked += 1
        if pets_checked > MAX_PETS:
            raise WosNavigationError(
                f"goto_pet: '{target}' not found after checking all {MAX_PETS} pets"
            )

        # Tap right chevron to go to next pet
        found, (cx, cy) = find_template(img, TEMPLATE_PET_CHEVRON_RIGHT)
        if not found:
            raise WosNavigationError("goto_pet: right chevron not found on pet details screen")
        logger.info("goto_pet: tapping right chevron at (%d,%d)", cx, cy)
        emulator.tap(cx, cy)
        time.sleep(1)

    raise WosNavigationError(
        f"goto_pet: '{target}' not found after {max_attempts} attempts"
    )


def goto_pet_refine(emulator: WosEmulator, pet_name: str) -> bool:
    """
    Navigate to the Refine tab of a specific pet's details page.

    Flow:
    1. goto_pet(emulator, pet_name)
    2. Template-match + tap the Refine tab
    3. Verify the tab was found (raises WosNavigationError if not)

    Returns True on success.
    Raises WosNavigationError if the Refine tab is not found on the pet details screen.
    """
    goto_pet(emulator, pet_name)

    img = emulator.screencap_bgr()
    found, (cx, cy) = find_template(img, TEMPLATE_PET_REFINE_TAB)
    if not found:
        raise WosNavigationError(
            f"goto_pet_refine: Refine tab not found on pet details screen for '{pet_name}'"
        )
    logger.info("goto_pet_refine: tapping Refine tab at (%d,%d)", cx, cy)
    emulator.tap(cx, cy)
    time.sleep(1.5)
    logger.info("goto_pet_refine: arrived on Refine tab for '%s'", pet_name)
    return True


def _tap_right_of_template(emulator: WosEmulator, img: np.ndarray, template_path: str) -> Tuple[int, int]:
    """
    Find a template and tap just to the right of its right edge (at vertical center).

    Used for stone selectors on the Refine tab: the stone icon is on the left of each
    slot; tapping it opens an info popup, but tapping just past its right edge selects it.

    Returns the (x, y) that was tapped.
    Raises WosNavigationError if the template is not found.
    """
    found, (bx, by) = find_template(img, template_path, anchor="bottom_right")
    if not found:
        raise WosNavigationError(f"_tap_right_of_template: template not found: {template_path}")
    tpl = cv2.imread(template_path)
    cy = by - tpl.shape[0] // 2
    tap_x = bx + 10
    logger.info("_tap_right_of_template: tapping (%d,%d) for %s", tap_x, cy, template_path)
    emulator.tap(tap_x, cy)
    return tap_x, cy


def select_refine_stone(emulator: WosEmulator, stone: str) -> bool:
    """
    Select Common or Advanced refinement stone on the pet Refine tab.

    Prerequisite: must already be on the Refine tab (use goto_pet_refine first).

    Args:
        stone: 'common' or 'advanced'

    Flow:
    1. Check if already selected via _is_selected template — if so, return immediately
    2. Tap just right of the stone icon template to select it
    3. Verify with _is_selected template
    4. Raise WosNavigationError if verification fails

    Returns True on success.
    """
    stone = stone.lower()
    if stone not in ("common", "advanced"):
        raise ValueError(f"select_refine_stone: stone must be 'common' or 'advanced', got '{stone}'")

    select_tpl  = TEMPLATE_SELECT_COMMON       if stone == "common" else TEMPLATE_SELECT_ADVANCED
    verify_tpl  = TEMPLATE_COMMON_IS_SELECTED  if stone == "common" else TEMPLATE_ADVANCED_IS_SELECTED

    img = emulator.screencap_bgr()

    # Already selected?
    already, _ = find_template(img, verify_tpl)
    if already:
        logger.info("select_refine_stone: '%s' already selected", stone)
        return True

    # Tap to select
    _tap_right_of_template(emulator, img, select_tpl)
    time.sleep(1.5)

    # Verify
    img_after = emulator.screencap_bgr()
    confirmed, _ = find_template(img_after, verify_tpl)
    if not confirmed:
        raise WosNavigationError(
            f"select_refine_stone: '{stone}' not confirmed selected after tap"
        )
    logger.info("select_refine_stone: '%s' selected and verified", stone)
    return True


def _dismiss_popups(emulator: WosEmulator, max_attempts: int = 8) -> bool:
    """
    Press back repeatedly until reaching the quit game dialog, then back once more to dismiss it.
    """
    for attempt in range(max_attempts):
        img = emulator.screencap_bgr()
        found, _ = find_template(img, TEMPLATE_QUIT_DIALOG)
        if found:
            logger.info("dismiss_popups: quit dialog found on attempt %d → tapping back to dismiss", attempt)
            emulator.back()
            time.sleep(1)
            return True
        logger.info("dismiss_popups: attempt %d - no quit dialog, tapping back", attempt)
        emulator.back()
        time.sleep(1)
    logger.warning("dismiss_popups: max attempts reached without finding quit dialog")
    return False


# ─── Coordinate navigation ────────────────────────────────────────────────────
TEMPLATE_COORD_SEARCH_ICON = str(_TEMPLATES_DIR / "world_coord_search_icon.png")
TEMPLATE_COORD_X_FIELD     = str(_TEMPLATES_DIR / "coord_dialog_x_field.png")
TEMPLATE_COORD_Y_FIELD     = str(_TEMPLATES_DIR / "coord_dialog_y_field.png")
TEMPLATE_COORD_GO_BTN      = str(_TEMPLATES_DIR / "coord_dialog_go_btn.png")


def goto_coord(emulator: WosEmulator, x: int, y: int) -> bool:
    """
    Navigate the world map to a specific X,Y coordinate.

    Flow:
    1. Ensure on world map
    2. Template-match the search icon (magnifying glass next to coord display)
    3. Tap it → Coordinates dialog opens
    4. Clear X field (6x backspace), type x
    5. Clear Y field (6x backspace), type y
    6. Template-match and tap Go
    7. Wait for map to pan

    Returns True on success.
    Raises WosNavigationError if any template not found.
    """
    goto_world_map(emulator)

    # Find and tap the search icon
    img = emulator.screencap_bgr()
    found, (cx, cy) = find_template(img, TEMPLATE_COORD_SEARCH_ICON)
    if not found:
        raise WosNavigationError("goto_coord: coordinate search icon not found on world map")
    logger.info("goto_coord: tapping search icon at (%d,%d)", cx, cy)
    emulator.tap(cx, cy)
    time.sleep(1.5)

    # Use OCR to locate X: and Y: labels, tap the input box to the right of each
    try:
        from ocr import RapidOCR
        _ocr = RapidOCR()
    except ImportError as e:
        raise WosNavigationError(f"goto_coord: RapidOCR not available: {e}")

    img = emulator.screencap_bgr()
    import cv2 as _cv2
    ocr_result, _ = _ocr(img)
    x_label_cy, y_label_cy = None, None
    if ocr_result:
        for line in ocr_result:
            box, text, conf = line
            cy = int(sum(p[1] for p in box) / 4)
            cx = int(sum(p[0] for p in box) / 4)
            t = text.strip().upper()
            if t in ('X:', 'X') and cx < 200 and x_label_cy is None:
                x_label_cy = cy
            elif t in ('Y:', 'Y') and cx > 300 and y_label_cy is None:
                y_label_cy = cy

    if x_label_cy is None or y_label_cy is None:
        raise WosNavigationError(
            f"goto_coord: could not locate X/Y labels via OCR (x_cy={x_label_cy}, y_cy={y_label_cy})"
        )

    # Tap input box (right of label) and enter value
    x_input_x, x_input_y = 245, x_label_cy
    y_input_x, y_input_y = 490, y_label_cy

    logger.info("goto_coord: tapping X input at (%d,%d)", x_input_x, x_input_y)
    emulator.tap(x_input_x, x_input_y)
    time.sleep(0.5)
    emulator.shell("input keyevent 67 67 67 67 67 67")
    time.sleep(0.3)
    emulator.shell(f"input text '{x}'")
    time.sleep(0.3)

    logger.info("goto_coord: tapping Y input at (%d,%d)", y_input_x, y_input_y)
    emulator.tap(y_input_x, y_input_y)
    time.sleep(0.5)
    emulator.shell("input keyevent 67 67 67 67 67 67")
    time.sleep(0.3)
    emulator.shell(f"input text '{y}'")
    time.sleep(0.3)

    # Tap Go
    img = emulator.screencap_bgr()
    found, (gx, gy) = find_template(img, TEMPLATE_COORD_GO_BTN)
    if not found:
        raise WosNavigationError("goto_coord: Go button not found in coordinates dialog")
    logger.info("goto_coord: tapping Go at (%d,%d)", gx, gy)
    emulator.tap(gx, gy)
    time.sleep(2)

    logger.info("goto_coord: navigated to X=%d Y=%d", x, y)
    return True
