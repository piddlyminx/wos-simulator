"""Per-instance process locks for wosctl emulator-driving commands."""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import socket
import sys
import time


class InstanceLockError(RuntimeError):
    """Raised when a required emulator instance lock cannot be acquired."""


@dataclass(frozen=True)
class InstanceLockOwner:
    pid: int | None
    command: str
    lock_path: Path


_SAFE_LOCK_CHAR = re.compile(r"[^a-z0-9_.-]+")


def testcase_instance_names(spec_path: str | os.PathLike[str]) -> list[str]:
    """Return unique instance names driven by a battle/testcase spec."""
    spec = json.loads(Path(spec_path).read_text())
    emulator = spec.get("emulator")
    if not isinstance(emulator, dict):
        raise InstanceLockError("battle spec is missing an 'emulator' object")

    names: list[str] = []
    for role in sorted(emulator):
        role_config = emulator[role]
        if not isinstance(role_config, dict):
            raise InstanceLockError(f"battle spec emulator.{role} must be an object")
        name = str(role_config.get("instance", "")).strip()
        if not name:
            raise InstanceLockError(f"battle spec emulator.{role}.instance is required")
        if name.casefold() not in {existing.casefold() for existing in names}:
            names.append(name)
    return sorted(names, key=str.casefold)


testcase_instance_names.__test__ = False


def _lock_filename(instance_name: str) -> str:
    normalized = _SAFE_LOCK_CHAR.sub("_", instance_name.strip().casefold()).strip("._")
    if not normalized:
        normalized = "unnamed"
    return f"{normalized}.lock"


def _command_for_pid(pid: int | None) -> str:
    if pid is None:
        return ""
    try:
        raw = Path(f"/proc/{pid}/cmdline").read_bytes()
    except OSError:
        return ""
    return raw.replace(b"\x00", b" ").decode(errors="replace").strip()


def _pid_is_alive(pid: int | None) -> bool:
    if pid is None or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _read_owner(lock_path: Path) -> InstanceLockOwner:
    try:
        data = json.loads(lock_path.read_text())
    except (OSError, json.JSONDecodeError):
        return InstanceLockOwner(pid=None, command="", lock_path=lock_path)
    pid_raw = data.get("pid")
    pid = pid_raw if isinstance(pid_raw, int) else None
    command = str(data.get("command") or _command_for_pid(pid))
    return InstanceLockOwner(pid=pid, command=command, lock_path=lock_path)


def _owner_description(owner: InstanceLockOwner) -> str:
    parts = []
    if owner.pid is not None:
        parts.append(f"pid={owner.pid}")
    if owner.command:
        parts.append(f"command={owner.command!r}")
    if not parts:
        parts.append(f"lock={owner.lock_path}")
    return ", ".join(parts)


class InstanceLock:
    """Atomic file lock for one configured emulator instance name."""

    def __init__(self, instance_name: str, lock_dir: Path) -> None:
        self.instance_name = instance_name
        self.lock_dir = lock_dir
        self.path = lock_dir / _lock_filename(instance_name)
        self._acquired = False

    def acquire(self) -> None:
        self.lock_dir.mkdir(parents=True, exist_ok=True)
        payload = {
            "instance_name": self.instance_name,
            "pid": os.getpid(),
            "command": " ".join(os.fsdecode(arg) for arg in sys.argv),
            "hostname": socket.gethostname(),
            "created_at": time.time(),
        }
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        while True:
            try:
                fd = os.open(self.path, flags, 0o644)
            except FileExistsError as exc:
                owner = _read_owner(self.path)
                if owner.pid is not None and not _pid_is_alive(owner.pid):
                    try:
                        self.path.unlink()
                    except FileNotFoundError:
                        continue
                    except OSError as unlink_exc:
                        raise InstanceLockError(
                            f"Instance '{self.instance_name}' is locked and stale lock cleanup failed: {unlink_exc}"
                        ) from unlink_exc
                    continue
                raise InstanceLockError(
                    f"Instance '{self.instance_name}' is already locked by {_owner_description(owner)}"
                ) from exc
            else:
                with os.fdopen(fd, "w") as handle:
                    json.dump(payload, handle, indent=2)
                    handle.write("\n")
                self._acquired = True
                return

    def release(self) -> None:
        if not self._acquired:
            return
        try:
            owner = _read_owner(self.path)
            if owner.pid == os.getpid():
                self.path.unlink()
        except FileNotFoundError:
            pass
        finally:
            self._acquired = False


@contextmanager
def lock_instances(
    instance_names: list[str],
    lock_dir: Path,
):
    """Acquire all instance locks in deterministic order, then release on exit."""
    locks = [
        InstanceLock(name, lock_dir)
        for name in sorted(instance_names, key=str.casefold)
    ]
    acquired: list[InstanceLock] = []
    try:
        for lock in locks:
            lock.acquire()
            acquired.append(lock)
        yield
    finally:
        for lock in reversed(acquired):
            lock.release()
