"""
emulator.py — MuMu Player + ADB management from WSL2.

Python implementation of emulator control, extended with reliability patterns:
- Dynamic instance resolution by name via MuMuManager API (no hardcoded table)
- Human-jitter random taps
- Multi-strategy wos_is_foreground check
- ADB reconnect helper
- Explicit ensure_running / ensure_foreground pipeline (reliability over speed)
- WosEmulator: single object encapsulating instance_name + serial + ADB methods
"""
from __future__ import annotations

import glob
import json
import logging
import os
import random
import re
import shlex
import subprocess
import time
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# ─── Paths ─────────────────────────────────────────────────────────────────────
CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.json"


def _load_app_config() -> dict:
    """Load emulator/app config from skill/config.json.

    Raises FileNotFoundError if config.json is missing — run wosctl
    interactively first to create it via the onboarding wizard.
    """
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(
            f"{CONFIG_PATH} not found. Run wosctl interactively to create it."
        )
    return json.loads(CONFIG_PATH.read_text())


_APP_CONFIG = _load_app_config()
MM_EXE = str(_APP_CONFIG["mumu_manager"])
WOS_PKG = str(_APP_CONFIG["package"])
WOS_ACTIVITY = str(_APP_CONFIG.get("activity", "")).strip()
WOS_COMPONENT = f"{WOS_PKG}/{WOS_ACTIVITY}" if WOS_ACTIVITY else f"{WOS_PKG}/"
EMULATOR_BOOT_SEC = int(_APP_CONFIG["timeouts"]["emulator_boot_sec"])
ANDROID_READY_SEC = int(_APP_CONFIG["timeouts"]["android_ready_sec"])
APP_LAUNCH_SEC = int(_APP_CONFIG["timeouts"]["app_launch_sec"])
ADB_CONNECT_SEC = int(_APP_CONFIG["timeouts"]["adb_connect_sec"])

# ─── Exceptions ────────────────────────────────────────────────────────────────
class WosError(Exception):
    """Base error for all wos emulator/ADB failures."""


def get_instance_config(name: str) -> dict:
    """Return the config block for an instance name, matched case-insensitively."""
    instances = _APP_CONFIG.get("instances", {})
    if not isinstance(instances, dict):
        return {}

    normalized_name = name.strip().lower()
    for instance_name, config in instances.items():
        if str(instance_name).strip().lower() != normalized_name:
            continue
        return config if isinstance(config, dict) else {}
    return {}


def is_instance_disabled(name: str) -> bool:
    """Return True when an instance is marked as unavailable for control."""
    return bool(get_instance_config(name).get("disabled", False))


def ensure_instance_enabled(name: str) -> None:
    """Raise when an instance is marked disabled in config.json."""
    if is_instance_disabled(name):
        raise WosError(
            f"Instance '{name}' is disabled in config.json and should not be used for control"
        )


# ─── WSL interop helper ────────────────────────────────────────────────────────
def _get_wsl_interop() -> str | None:
    """Find the WSL_INTEROP socket path dynamically.

    The OpenClaw service runs in a cgroup where WSL_INTEROP may be unset, so
    we fall back to scanning /run/WSL/ for the socket.
    """
    # Check env first (already set)
    val = os.environ.get("WSL_INTEROP")
    if val and os.path.exists(val):
        return val
    # Find the socket in /run/WSL/
    sockets = sorted(glob.glob("/run/WSL/*_interop"), reverse=True)
    if sockets:
        return sockets[0]
    return None


def _mumu_cmd(args: str) -> str:
    """Run MuMuManager.exe directly via WSL interop and return combined output."""
    env = os.environ.copy()
    interop = _get_wsl_interop()
    if interop:
        env["WSL_INTEROP"] = interop

    # IMPORTANT: MuMuManager.exe is sensitive to the current working directory.
    # When invoked from mergerfs-mounted agent workspaces it can fail with
    # "Invalid argument". Force a Windows-path cwd to make invocation stable.
    result = subprocess.run(
        [MM_EXE, *shlex.split(args)],
        capture_output=True,
        text=True,
        env=env,
        cwd="/mnt/c/Windows/System32",
    )
    return (result.stdout + result.stderr).strip()


# _mm_cmd is kept as an alias so internal callers using positional args still work.
def _mm_cmd(*args: str) -> str:
    return _mumu_cmd(" ".join(args))


def _parse_json(raw: str) -> dict:
    """Parse JSON from MuMuManager output.

    Falls back to regex field extraction if JSON decode fails (MuMuManager quirk).
    When raw is a JSON object returns a dict; when it's the all-instances response
    it is already a dict keyed by string index.
    """
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        info: dict = {}
        for key in ("vmindex", "name", "adb_port", "is_process_started", "is_android_started"):
            m = re.search(rf'"{key}"\s*:\s*([^,}}]+)', raw)
            if m:
                val = m.group(1).strip().strip('"')
                if val.lower() == "true":
                    info[key] = True
                elif val.lower() == "false":
                    info[key] = False
                elif val.lstrip("-").isdigit():
                    info[key] = int(val)
                else:
                    info[key] = val
        return info


def mumu_info(idx: int) -> dict:
    """Return parsed info dict for a vmindex.

    Expected keys: vmindex, name, adb_port, is_process_started, is_android_started.
    Falls back to regex parsing if JSON decode fails (MuMuManager quirk).
    """
    raw = _mm_cmd(f"info --vmindex {idx}")
    return _parse_json(raw)


def mumu_is_running(idx: int) -> bool:
    """Return True when both process and Android are started for vmindex."""
    try:
        info = mumu_info(idx)
        return bool(info.get("is_process_started")) and bool(info.get("is_android_started"))
    except Exception as exc:
        logger.debug("mumu_is_running(%s) failed: %s", idx, exc)
        return False


def mumu_get_adb_port(idx: int) -> int | None:
    """Return ADB port from MuMuManager API, or None on failure."""
    try:
        info = mumu_info(idx)
        port = info.get("adb_port")
        return int(port) if port is not None else None
    except Exception:
        return None


def _port_formula(idx: int) -> int:
    """Port formula: 16384 + (idx * 32). Used as cross-check against API."""
    return 16384 + (idx * 32)


def mumu_launch(idx: int) -> None:
    logger.info("Launching MuMu instance %d...", idx)
    _mm_cmd(f"control --vmindex {idx} launch")


def mumu_shutdown(idx: int) -> None:
    logger.info("Shutting down MuMu instance %d...", idx)
    _mm_cmd(f"control --vmindex {idx} shutdown")


def mumu_restart(idx: int) -> None:
    logger.info("Restarting MuMu instance %d...", idx)
    _mm_cmd(f"control --vmindex {idx} restart")


# ─── Instance resolution ────────────────────────────────────────────────────────
def list_instances() -> list[dict]:
    """Return all MuMu instances reported by ``info --vmindex all``."""
    raw = _mumu_cmd("info --vmindex all")
    data = _parse_json(raw)
    if not isinstance(data, dict):
        raise WosError("MuMuManager returned an unexpected instance payload")

    instances: list[dict] = []
    for fallback_idx, info in data.items():
        if not isinstance(info, dict):
            continue

        error_code = info.get("error_code", info.get("errcode", 0))
        if error_code == -200:
            continue

        idx_raw = info.get("vmindex", info.get("index", fallback_idx))
        try:
            idx = int(idx_raw)
        except (TypeError, ValueError):
            logger.debug("Skipping MuMu instance with invalid index %r", idx_raw)
            continue

        normalized = dict(info)
        normalized["vmindex"] = idx

        port = normalized.get("adb_port")
        try:
            normalized["adb_port"] = int(port) if port is not None else _port_formula(idx)
        except (TypeError, ValueError):
            normalized["adb_port"] = _port_formula(idx)

        instances.append(normalized)

    instances.sort(key=lambda item: item["vmindex"])
    return instances


def _resolve_instance_idx_port(name: str) -> tuple[int, int]:
    """Find instance index and port by name via MuMuManager (single call).

    Uses ``info --vmindex all`` to enumerate all instances in one round-trip
    instead of scanning indices 0–N individually.

    Returns:
        (idx, port) — integer index and ADB port of the matching instance.

    Raises:
        WosError: if no instance with the given name is found.
    """
    for info in list_instances():
        idx = int(info["vmindex"])
        if info.get("name", "").lower() == name.lower():
            return idx, int(info["adb_port"])
    raise WosError(f"Instance '{name}' not found")


# ─── ADB primitives ────────────────────────────────────────────────────────────
def _adb_cli(
    *args: str,
    timeout_sec: float | None = None,
) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["adb", *args],
        capture_output=True,
        text=True,
        timeout=timeout_sec,
    )


def _adb(
    serial: str,
    *args: str,
    timeout_sec: float | None = None,
) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["adb", "-s", serial, *args],
        capture_output=True,
        text=True,
        timeout=timeout_sec,
    )


def restart_adb_server(timeout_sec: float = 3.0) -> None:
    """Restart the local ADB server and verify it via ``adb devices``."""
    try:
        _adb_cli("kill-server", timeout_sec=timeout_sec)
    except subprocess.TimeoutExpired:
        logger.warning("adb kill-server timed out; continuing with daemon bootstrap")

    result = _adb_cli("devices", timeout_sec=timeout_sec)
    if result.returncode == 0 and "List of devices attached" in result.stdout:
        return

    details = result.stderr.strip() or result.stdout.strip() or f"adb exited with code {result.returncode}"
    raise WosError(f"adb devices failed after restart: {details}")


def adb_ping(
    serial: str,
    timeout_sec: float = 2.0,
    restart_timeout_sec: float = 3.0,
    restart_settle_sec: float = 1.0,
) -> tuple[bool, bool, str | None]:
    """Check whether ADB responds quickly, restarting the server once on failure."""
    restarted_server = False
    last_error: str | None = None

    for attempt in range(1, 3):
        probe_timeout_sec = restart_timeout_sec if restarted_server else timeout_sec
        try:
            if restarted_server:
                _adb_cli("disconnect", serial, timeout_sec=probe_timeout_sec)

            subprocess.run(
                ["adb", "connect", serial],
                capture_output=True,
                text=True,
                timeout=probe_timeout_sec,
            )
            result = _adb(serial, "shell", "echo", "ok", timeout_sec=probe_timeout_sec)
        except subprocess.TimeoutExpired as exc:
            last_error = str(exc)
            logger.warning("ADB ping timed out on %s (attempt %d/2)", serial, attempt)
        else:
            if result.returncode == 0 and "ok" in result.stdout:
                return True, restarted_server, None
            last_error = result.stderr.strip() or f"adb exited with code {result.returncode}"
            logger.warning(
                "ADB ping failed on %s (attempt %d/2): rc=%s stderr=%s",
                serial,
                attempt,
                result.returncode,
                result.stderr.strip(),
            )

        if attempt == 1:
            restarted_server = True
            logger.warning("Restarting ADB server after failed ping on %s", serial)
            try:
                restart_adb_server(timeout_sec=restart_timeout_sec)
                if restart_settle_sec > 0:
                    time.sleep(restart_settle_sec)
            except Exception as exc:
                last_error = str(exc)
                break

    return False, restarted_server, last_error


def adb_connect(serial: str, timeout_sec: float = ADB_CONNECT_SEC) -> bool:
    """Connect to device and verify ADB is responsive. Returns True on success."""
    subprocess.run(
        ["adb", "connect", serial],
        capture_output=True,
        text=True,
        timeout=timeout_sec,
    )
    time.sleep(1)
    result = _adb(serial, "shell", "echo", "ok", timeout_sec=timeout_sec)
    ok = result.returncode == 0 and "ok" in result.stdout
    if ok:
        logger.debug("ADB connected: %s", serial)
    else:
        logger.warning("ADB connection to %s failed", serial)
    return ok


def adb_reconnect(serial: str) -> None:
    """Disconnect, pause, reconnect — recovers from INJECT_EVENTS errors."""
    subprocess.run(["adb", "disconnect", serial], capture_output=True)
    time.sleep(0.5)
    subprocess.run(["adb", "connect", serial], capture_output=True)
    time.sleep(1)


def adb_shell(serial: str, cmd: str, timeout_sec: float | None = None) -> str:
    """Run a shell command on the device and return stdout."""
    result = _adb(serial, "shell", cmd, timeout_sec=timeout_sec)
    return result.stdout


def adb_tap(serial: str, x: int, y: int) -> None:
    _adb(serial, "shell", "input", "tap", str(x), str(y))


def adb_tap_random(serial: str, x1: int, y1: int, x2: int, y2: int) -> None:
    """Tap a random point within the bounding box — adds human-like jitter."""
    x = random.randint(x1, x2)
    y = random.randint(y1, y2)
    adb_tap(serial, x, y)


def adb_swipe(
    serial: str, x1: int, y1: int, x2: int, y2: int, dur_ms: int = 300
) -> None:
    _adb(serial, "shell", "input", "swipe",
         str(x1), str(y1), str(x2), str(y2), str(dur_ms))


def adb_back(serial: str) -> None:
    _adb(serial, "shell", "input", "keyevent", "KEYCODE_BACK")


def adb_screencap(
    serial: str,
    out_path: str,
    timeout_sec: float | None = None,
) -> None:
    """Capture screen to a local file using screencap -p."""
    result = subprocess.run(
        ["adb", "-s", serial, "exec-out", "screencap", "-p"],
        capture_output=True,
        timeout=timeout_sec,
    )
    Path(out_path).write_bytes(result.stdout)


def adb_screencap_bgr(
    serial: str,
    timeout_sec: float | None = None,
) -> np.ndarray:
    """Capture screen and decode it directly into a BGR image."""
    result = subprocess.run(
        ["adb", "-s", serial, "exec-out", "screencap", "-p"],
        capture_output=True,
        timeout=timeout_sec,
    )
    if result.returncode != 0 or not result.stdout:
        raise WosError(f"screencap failed for {serial}")
    buf = np.frombuffer(result.stdout, dtype=np.uint8)
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if img is None:
        raise WosError(f"screencap decode failed for {serial}")
    return img


# ─── App control ───────────────────────────────────────────────────────────────
def wos_launch(serial: str) -> None:
    """Launch WOS via monkey (more reliable than am start)."""
    logger.info("Launching WOS on %s...", serial)
    adb_shell(serial, f"monkey -p {WOS_PKG} -c android.intent.category.LAUNCHER 1")


def wos_stop(serial: str) -> None:
    logger.info("Force-stopping WOS on %s...", serial)
    adb_shell(serial, f"am force-stop {WOS_PKG}")


def wos_is_foreground(serial: str, timeout_sec: float | None = None) -> bool:
    """Return True if WOS is currently in the foreground.

    Tries four dumpsys strategies in order for maximum reliability.
    """
    strategies = [
        ("dumpsys window windows",      re.escape(WOS_COMPONENT)),
        ("dumpsys window displays",     re.escape(WOS_COMPONENT)),
        ("dumpsys window",              re.escape(WOS_COMPONENT)),
        ("dumpsys activity activities", rf"mResumedActivity.*{re.escape(WOS_COMPONENT)}"),
    ]
    for cmd, pattern in strategies:
        output = adb_shell(serial, cmd, timeout_sec=timeout_sec)
        if re.search(pattern, output):
            return True
    return False


# ─── Startup pipeline ──────────────────────────────────────────────────────────
def ensure_running(name: str) -> tuple[int, int]:
    """Ensure the named MuMu emulator instance is running and ADB is connected.

    Steps (always execute all — reliability over efficiency):
    1. _resolve_instance_idx_port(name)  → get idx + port from MuMuManager
    2. Check is_process_started + is_android_started from fresh info call
    3. If not running → mumu_launch(idx) → wait up to ``emulator_boot_sec`` polling every 5s
    4. adb connect 127.0.0.1:<port> during a short ``android_ready_sec`` settle window
    5. Verify ADB is responsive using ``adb_connect_sec`` as the per-attempt probe timeout
    6. Return (idx, port)

    Raises:
        WosError: if the instance cannot be found, started, or connected.
    """
    # Step 1: Resolve name → (idx, port)
    idx, port = _resolve_instance_idx_port(name)
    serial = f"127.0.0.1:{port}"
    logger.info("Resolved '%s' → idx=%d port=%d serial=%s", name, idx, port, serial)

    # Step 2: Check running state (fresh info call — separate from _resolve_instance_idx_port)
    info = mumu_info(idx)
    process_up = bool(info.get("is_process_started"))
    android_up = bool(info.get("is_android_started"))
    logger.info(
        "Instance %d state: is_process_started=%s is_android_started=%s",
        idx, process_up, android_up,
    )

    # Step 3: Launch if not running, then poll until ready
    if not (process_up and android_up):
        logger.info("Instance %d not fully started; launching...", idx)
        mumu_launch(idx)

        timeout_sec = EMULATOR_BOOT_SEC
        elapsed = 0
        ready = False
        while elapsed < timeout_sec:
            time.sleep(5)
            elapsed += 5
            poll = mumu_info(idx)
            if bool(poll.get("is_process_started")) and bool(poll.get("is_android_started")):
                logger.info("Instance %d ready after %ds", idx, elapsed)
                ready = True
                break
            logger.debug("Instance %d not ready yet (%ds elapsed)", idx, elapsed)

        if not ready:
            raise WosError(
                f"Emulator instance {idx} ('{name}') did not become ready "
                f"within {timeout_sec}s after launch."
            )
    else:
        logger.info("Instance %d already running.", idx)

    # Step 4: ADB connect with retries during a short Android-settle window
    deadline = time.monotonic() + ANDROID_READY_SEC
    connected = False
    attempt = 0
    while time.monotonic() < deadline:
        attempt += 1
        try:
            subprocess.run(
                ["adb", "connect", serial],
                capture_output=True,
                text=True,
                timeout=ADB_CONNECT_SEC,
            )
            result = _adb(serial, "shell", "echo", "ok", timeout_sec=ADB_CONNECT_SEC)
        except subprocess.TimeoutExpired:
            logger.warning(
                "ADB connect/probe timed out on %s (attempt %d, timeout=%ss)",
                serial,
                attempt,
                ADB_CONNECT_SEC,
            )
            time.sleep(1)
            continue

        if result.returncode == 0 and "ok" in result.stdout:
            logger.info("ADB responsive on %s (attempt %d)", serial, attempt)
            connected = True
            break

        logger.warning("ADB not responsive on %s (attempt %d)", serial, attempt)
        time.sleep(2)

    if not connected:
        raise WosError(
            f"Could not establish ADB connection to {serial} within {ANDROID_READY_SEC}s "
            f"after Android reported ready."
        )

    # Step 6: Return (idx, port)
    return (idx, port)


def ensure_foreground(serial: str) -> None:
    """Ensure WOS is in the foreground on the given ADB serial.

    Steps (always execute all — reliability over efficiency):
    1. Check wos_is_foreground(serial) using all 4 dumpsys strategies
    2. If not foreground → wos_launch(serial) via monkey
    3. Wait up to ``app_launch_sec`` polling wos_is_foreground every 5s
    4. Final verify → raise WosError if still not foreground

    Raises:
        WosError: if WOS is not foreground after the configured launch wait.
    """
    # Step 1: Check foreground state
    already_foreground = wos_is_foreground(serial)
    logger.info("WOS foreground check on %s: %s", serial, already_foreground)

    # Step 2: Launch if not foreground
    if not already_foreground:
        logger.info("WOS not foreground; launching via monkey on %s...", serial)
        wos_launch(serial)

        # Step 3: Poll up to the configured launch timeout
        timeout_sec = APP_LAUNCH_SEC
        elapsed = 0
        while elapsed < timeout_sec:
            time.sleep(5)
            elapsed += 5
            if wos_is_foreground(serial):
                logger.info("WOS reached foreground after %ds", elapsed)
                break
            logger.debug("WOS not foreground yet (%ds elapsed)", elapsed)

    # Step 4: Final verify (always — even if we skipped launch)
    if not wos_is_foreground(serial):
        raise WosError(
            f"WOS is not in the foreground on {serial} after ensure_foreground. "
            "The app may have failed to start or another window is covering it."
        )
    logger.info("WOS confirmed in foreground on %s", serial)


# ─── WosEmulator: the primary abstraction ─────────────────────────────────────
class WosEmulator:
    """Encapsulates a running MuMu emulator instance with ADB-ready access.

    Construct via ``resolve_instance(name)`` — never directly.

    All ADB operations on the device go through this object; callers never
    need to pass or store a raw ``serial`` string.
    """

    def __init__(self, instance_name: str, instance_idx: int, serial: str) -> None:
        self.instance_name = instance_name
        self.instance_idx = instance_idx
        self.serial = serial  # "127.0.0.1:<port>" — needed for low-level ADB callers

    # ── ADB primitives ─────────────────────────────────────────────────────────

    def shell(self, cmd: str, timeout_sec: float | None = None) -> str:
        """Run an adb shell command and return stdout."""
        return adb_shell(self.serial, cmd, timeout_sec=timeout_sec)

    def tap(self, x: int, y: int) -> None:
        adb_tap(self.serial, x, y)

    def swipe(self, x1: int, y1: int, x2: int, y2: int, dur_ms: int = 300) -> None:
        adb_swipe(self.serial, x1, y1, x2, y2, dur_ms)

    def key(self, keyevent: str) -> None:
        """Send a keyevent by name or code, e.g. 'KEYCODE_BACK' or '4'."""
        self.shell(f"input keyevent {keyevent}")

    def back(self) -> None:
        adb_back(self.serial)

    def screencap(self, out_path: str, timeout_sec: float | None = None) -> None:
        """Capture screen to a local file."""
        adb_screencap(self.serial, out_path, timeout_sec=timeout_sec)

    def screencap_bgr(self, timeout_sec: float | None = None) -> np.ndarray:
        """Capture screen and return as a BGR numpy array."""
        return adb_screencap_bgr(self.serial, timeout_sec=timeout_sec)

    # ── State queries ──────────────────────────────────────────────────────────

    def is_foreground(self, timeout_sec: float | None = None) -> bool:
        """Return True if WOS is currently in the foreground."""
        return wos_is_foreground(self.serial, timeout_sec=timeout_sec)

    def ping(
        self,
        timeout_sec: float = 2.0,
        restart_timeout_sec: float = 3.0,
        restart_settle_sec: float = 1.0,
    ) -> tuple[bool, bool, str | None]:
        """Check ADB responsiveness (with optional server restart)."""
        return adb_ping(
            self.serial,
            timeout_sec=timeout_sec,
            restart_timeout_sec=restart_timeout_sec,
            restart_settle_sec=restart_settle_sec,
        )

    def __repr__(self) -> str:
        return f"WosEmulator(name={self.instance_name!r}, idx={self.instance_idx}, serial={self.serial!r})"


def resolve_instance(name: str) -> WosEmulator:
    """Resolve an instance name → running WosEmulator.

    Performs the full startup pipeline:
      1. MuMu lookup (name → idx, port)
      2. Ensure emulator is running (launch + poll if needed)
      3. ADB connect + responsiveness check
      4. WOS foreground check (launch app if needed)

    Returns a ready-to-use ``WosEmulator``.

    Raises:
        WosError: if any step fails.
    """
    ensure_instance_enabled(name)
    idx, port = ensure_running(name)
    serial = f"127.0.0.1:{port}"
    ensure_foreground(serial)
    return WosEmulator(instance_name=name, instance_idx=idx, serial=serial)
