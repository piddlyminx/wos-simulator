"""Exact-state capture for dirty working trees.

When a test run happens on a dirty git tree, we need to be able to reproduce
it exactly from the dashboard. This module captures two gzipped blobs:

* ``patch`` — output of ``git diff HEAD`` (staged + unstaged tracked changes).
* ``untracked`` — a gzipped tar of every untracked-but-not-ignored file.

Each blob gets a content-addressed id of the form ``sha256:<hex>`` so the
ingestion layer can dedupe blobs across runs.

The sibling ingestion task (WOS-162 Phase 1) is the sole consumer. This module
never writes to a database — it only produces bytes and ids.
"""

from __future__ import annotations

import gzip
import hashlib
import io
import subprocess
import tarfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, TypedDict


class CapturedDirtyState(TypedDict):
    """Return payload of :func:`capture_dirty_state`.

    The ``*_blob_id`` fields are the FK-safe identifiers stored on the
    ``runs`` row. The ``*_content_gzip`` fields are the gzipped bytes the
    ingestion layer persists to the ``blobs`` table keyed by those ids.
    Both pairs are ``None`` when the working tree is clean.
    """

    patch_blob_id: Optional[str]
    untracked_blob_id: Optional[str]
    patch_content_gzip: Optional[bytes]
    untracked_content_gzip: Optional[bytes]


@dataclass(frozen=True)
class _GitStatus:
    has_tracked_changes: bool
    untracked_paths: tuple[str, ...]

    @property
    def is_dirty(self) -> bool:
        return self.has_tracked_changes or bool(self.untracked_paths)


def _run_git(repo_root: Path, *args: str, binary: bool = False) -> bytes:
    """Run a git command inside ``repo_root`` and return raw stdout bytes."""
    result = subprocess.run(
        ("git", *args),
        cwd=str(repo_root),
        check=True,
        capture_output=True,
    )
    return result.stdout if binary else result.stdout


def _porcelain_status(repo_root: Path) -> _GitStatus:
    """Read ``git status --porcelain -z`` and split into tracked vs untracked."""
    raw = _run_git(repo_root, "status", "--porcelain=v1", "-z", "--untracked-files=all")
    entries = [e for e in raw.split(b"\x00") if e]
    untracked: list[str] = []
    tracked_dirty = False
    i = 0
    while i < len(entries):
        entry = entries[i]
        # Each entry is "XY path"; "XY" is 2 status bytes + space.
        if len(entry) < 3:
            i += 1
            continue
        xy = entry[:2]
        path = entry[3:].decode("utf-8", errors="surrogateescape")
        if xy == b"??":
            untracked.append(path)
        else:
            tracked_dirty = True
            # Rename/copy entries (R*, C*) are followed by the old path.
            if xy[:1] in (b"R", b"C"):
                i += 1  # skip the "from" path token
        i += 1
    return _GitStatus(has_tracked_changes=tracked_dirty, untracked_paths=tuple(untracked))


def _sha256_id(content: bytes) -> str:
    return "sha256:" + hashlib.sha256(content).hexdigest()


def _capture_patch(repo_root: Path) -> Optional[tuple[str, bytes]]:
    diff = _run_git(repo_root, "diff", "HEAD", "--binary", binary=True)
    if not diff:
        return None
    blob = gzip.compress(diff)
    return _sha256_id(blob), blob


def _capture_untracked(
    repo_root: Path, paths: tuple[str, ...]
) -> Optional[tuple[str, bytes]]:
    if not paths:
        return None
    buf = io.BytesIO()
    # mtime=0 makes the archive reproducible for a given set of file contents,
    # which in turn stabilises the sha256 id.
    with tarfile.open(fileobj=buf, mode="w:gz", compresslevel=9) as tar:
        tar.mtime = 0  # type: ignore[attr-defined]
        for rel in sorted(paths):
            abs_path = repo_root / rel
            try:
                data = abs_path.read_bytes()
            except (FileNotFoundError, IsADirectoryError, PermissionError):
                # File vanished / unreadable between status and read: skip.
                continue
            info = tarfile.TarInfo(name=rel)
            info.size = len(data)
            info.mtime = 0
            info.mode = 0o644
            tar.addfile(info, io.BytesIO(data))
    blob = buf.getvalue()
    return _sha256_id(blob), blob


def capture_dirty_state(repo_root: Path | str) -> CapturedDirtyState:
    """Capture a reproducible snapshot of the working tree's dirty state.

    Returns blob ids of ``None`` when the tree is clean. When dirty, returns
    gzipped content plus content-addressed sha256 ids for whichever of
    (tracked patch, untracked tar) actually has changes.
    """
    root = Path(repo_root).resolve()
    status = _porcelain_status(root)
    if not status.is_dirty:
        return CapturedDirtyState(
            patch_blob_id=None,
            untracked_blob_id=None,
            patch_content_gzip=None,
            untracked_content_gzip=None,
        )

    patch = _capture_patch(root) if status.has_tracked_changes else None
    untracked = _capture_untracked(root, status.untracked_paths)

    return CapturedDirtyState(
        patch_blob_id=patch[0] if patch else None,
        untracked_blob_id=untracked[0] if untracked else None,
        patch_content_gzip=patch[1] if patch else None,
        untracked_content_gzip=untracked[1] if untracked else None,
    )
