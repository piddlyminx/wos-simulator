"""Canonical allowlist of simulator-relevant repo paths.

Dirty-run captures (``dashboard/state_capture.py``) and the dashboard UI
(``dashboard/web/lib/diff.ts`` via ``dashboard/web/lib/sim-paths.ts``) both
scope their diffs to files that can actually affect simulator behaviour.
Changes to dashboard code, scratch scripts, docs, or local test files cannot
move a testcase result; showing them in the diff just adds noise and erodes
trust in the dashboard's core board-facing question 3 ("what changed in
simulator code/config between two runs?").

Mirror any change to this list in ``dashboard/web/lib/sim-paths.ts``.
"""

from __future__ import annotations

from pathlib import PurePosixPath

SIMULATOR_PATH_PREFIXES: tuple[str, ...] = (
    "Base_classes/",
    "assets/",
    "skills/",
    "testcases/",
    "fighters_data/",
    "battle_specs_manual/",
)

SIMULATOR_ROOT_FILES: frozenset[str] = frozenset(
    {
        "pyproject.toml",
        "check_testcases.py",
        "battle_main.py",
        "compare_results.py",
    }
)


def is_simulator_path(rel_path: str) -> bool:
    """Return True if ``rel_path`` (repo-relative, POSIX-style) is simulator-relevant."""
    if not rel_path:
        return False
    normalized = str(PurePosixPath(rel_path))
    if normalized in SIMULATOR_ROOT_FILES:
        return True
    return any(normalized.startswith(prefix) for prefix in SIMULATOR_PATH_PREFIXES)


def git_pathspec_args() -> tuple[str, ...]:
    """Pathspec list suitable for ``git diff -- <pathspec>...`` calls."""
    return tuple(SIMULATOR_PATH_PREFIXES) + tuple(sorted(SIMULATOR_ROOT_FILES))
