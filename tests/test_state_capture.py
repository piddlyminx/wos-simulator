"""Unit tests for dashboard.state_capture.capture_dirty_state."""

from __future__ import annotations

import gzip
import io
import os
import subprocess
import sys
import tarfile
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

# Allow running this test directly from the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dashboard.state_capture import capture_dirty_state  # noqa: E402


def _git(repo: Path, *args: str) -> None:
    env = os.environ.copy()
    env["GIT_AUTHOR_NAME"] = "t"
    env["GIT_AUTHOR_EMAIL"] = "t@t"
    env["GIT_COMMITTER_NAME"] = "t"
    env["GIT_COMMITTER_EMAIL"] = "t@t"
    subprocess.run(("git", *args), cwd=str(repo), check=True, env=env, capture_output=True)


def _make_repo(tmp: Path) -> Path:
    repo = tmp / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    _git(repo, "config", "commit.gpgsign", "false")
    (repo / "tracked.txt").write_text("original\n")
    _git(repo, "add", "tracked.txt")
    _git(repo, "commit", "-q", "-m", "init")
    return repo


class CaptureDirtyStateTests(unittest.TestCase):
    def test_clean_tree_returns_all_none(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = _make_repo(Path(tmp))
            out = capture_dirty_state(repo)
            self.assertIsNone(out["patch_blob_id"])
            self.assertIsNone(out["untracked_blob_id"])
            self.assertIsNone(out["patch_content_gzip"])
            self.assertIsNone(out["untracked_content_gzip"])

    def test_tracked_change_produces_patch_blob_only(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = _make_repo(Path(tmp))
            (repo / "tracked.txt").write_text("modified\n")

            out = capture_dirty_state(repo)

            self.assertIsNotNone(out["patch_blob_id"])
            self.assertTrue(out["patch_blob_id"].startswith("sha256:"))
            self.assertIsNone(out["untracked_blob_id"])

            decoded = gzip.decompress(out["patch_content_gzip"]).decode()
            self.assertIn("-original", decoded)
            self.assertIn("+modified", decoded)

    def test_untracked_file_produces_untracked_blob_only(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = _make_repo(Path(tmp))
            (repo / "new.txt").write_bytes(b"hello\x00world")
            (repo / "sub").mkdir()
            (repo / "sub" / "nested.bin").write_bytes(bytes(range(256)))

            out = capture_dirty_state(repo)

            self.assertIsNone(out["patch_blob_id"])
            self.assertIsNotNone(out["untracked_blob_id"])
            self.assertTrue(out["untracked_blob_id"].startswith("sha256:"))

            with tarfile.open(fileobj=io.BytesIO(out["untracked_content_gzip"]), mode="r:gz") as tar:
                names = sorted(tar.getnames())
                self.assertEqual(names, ["new.txt", "sub/nested.bin"])
                self.assertEqual(tar.extractfile("new.txt").read(), b"hello\x00world")
                self.assertEqual(tar.extractfile("sub/nested.bin").read(), bytes(range(256)))

    def test_ignored_files_are_not_captured(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = _make_repo(Path(tmp))
            (repo / ".gitignore").write_text("ignored/\n")
            _git(repo, "add", ".gitignore")
            _git(repo, "commit", "-q", "-m", "add ignore")
            (repo / "ignored").mkdir()
            (repo / "ignored" / "secret").write_text("nope")

            out = capture_dirty_state(repo)
            self.assertIsNone(out["patch_blob_id"])
            self.assertIsNone(out["untracked_blob_id"])

    def test_both_tracked_and_untracked(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = _make_repo(Path(tmp))
            (repo / "tracked.txt").write_text("changed\n")
            (repo / "new.txt").write_text("fresh\n")

            out = capture_dirty_state(repo)
            self.assertIsNotNone(out["patch_blob_id"])
            self.assertIsNotNone(out["untracked_blob_id"])
            self.assertNotEqual(out["patch_blob_id"], out["untracked_blob_id"])

    def test_content_addressed_ids_are_stable(self) -> None:
        """Same file contents should yield the same blob id across captures."""
        with TemporaryDirectory() as tmp:
            repo = _make_repo(Path(tmp))
            (repo / "new.txt").write_text("stable\n")

            first = capture_dirty_state(repo)
            second = capture_dirty_state(repo)
            self.assertEqual(first["untracked_blob_id"], second["untracked_blob_id"])

    def test_accepts_string_path(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = _make_repo(Path(tmp))
            out = capture_dirty_state(str(repo))
            self.assertIsNone(out["patch_blob_id"])


if __name__ == "__main__":
    unittest.main()
