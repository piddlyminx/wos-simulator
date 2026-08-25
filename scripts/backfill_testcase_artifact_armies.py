from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class SourceVersion:
    created_at: datetime
    entries: tuple[dict[str, Any], ...]


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        description="Backfill exact testcase armies into retained parity artifacts.",
    )
    parser.add_argument("--repo-root", type=Path, default=repo_root)
    parser.add_argument(
        "--reports-dir",
        type=Path,
        default=repo_root / "simulator" / "testcase_results",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Atomically update artifacts. Without this flag the command is a dry run.",
    )
    return parser.parse_args()


def as_object(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def numeric_record(value: Any) -> dict[str, int | float]:
    return {
        str(key): candidate
        for key, candidate in as_object(value).items()
        if isinstance(candidate, (int, float)) and not isinstance(candidate, bool)
    }


def hero_record(value: Any) -> dict[str, dict[str, int | float]]:
    return {
        str(name): numeric_record(skills)
        for name, skills in as_object(value).items()
    }


def testcase_armies(entry: dict[str, Any]) -> dict[str, Any]:
    armies: dict[str, Any] = {}
    for side in ("attacker", "defender"):
        army = as_object(entry.get(side))
        armies[side] = {
            "heroes": hero_record(army.get("heroes")),
            "joinerHeroes": hero_record(army.get("joiner_heroes")),
            "troops": numeric_record(army.get("troops")),
        }
    return armies


def testcase_id(entry: dict[str, Any], index: int) -> str:
    return str(entry.get("test_id", entry.get("id", f"case_{index}")))


def entries_from_json(value: Any) -> tuple[dict[str, Any], ...]:
    values = value if isinstance(value, list) else [value]
    return tuple(entry for entry in values if isinstance(entry, dict))


def find_entry(
    entries: tuple[dict[str, Any], ...],
    expected_id: str,
    index: int,
) -> dict[str, Any] | None:
    if 0 <= index < len(entries) and testcase_id(entries[index], index) == expected_id:
        return entries[index]
    matches = [entry for offset, entry in enumerate(entries) if testcase_id(entry, offset) == expected_id]
    return matches[0] if len(matches) == 1 else None


def normalize_hero_name(value: str) -> str:
    return "".join(character for character in value.casefold() if character.isalnum())


def normalized_troops(troops: dict[str, int | float]) -> dict[str, int | float]:
    totals: dict[str, int | float] = {}
    for key, count in troops.items():
        unit_type = key.split("_", 1)[0]
        totals[unit_type] = totals.get(unit_type, 0) + count
    return {
        unit_type: count
        for unit_type, count in totals.items()
        if count != 0
    }


def definition_matches_detail(entry: dict[str, Any], detail: dict[str, Any]) -> bool:
    armies = testcase_armies(entry)
    visibility = as_object(detail.get("visibility"))
    result = as_object(detail.get("result"))
    resolved = as_object(result.get("resolved"))
    skill_report = as_object(result.get("skillReport"))

    for side in ("attacker", "defender"):
        army = armies[side]
        visible = as_object(visibility.get(side))
        resolved_side = as_object(resolved.get(side))
        resolved_heroes = resolved_side.get("heroes")
        reports = skill_report.get(side)

        raw_heroes = {
            normalize_hero_name(name)
            for name in [*army["heroes"], *army["joinerHeroes"]]
        }
        if isinstance(resolved_heroes, list):
            retained_heroes = {
                normalize_hero_name(str(hero.get("instanceId", "")).split(":")[1])
                if len(str(hero.get("instanceId", "")).split(":")) > 1
                else normalize_hero_name(str(hero.get("name", "")))
                for hero in resolved_heroes
                if isinstance(hero, dict)
            }
        else:
            retained_heroes = {
                normalize_hero_name(str(name))
                for name in visible.get("heroes", [])
                if isinstance(name, str)
            }
        if raw_heroes != retained_heroes:
            return False

        visible_troops = {
            unit_type: count
            for unit_type, count in numeric_record(visible.get("troops")).items()
            if count != 0
        }
        if normalized_troops(army["troops"]) != visible_troops:
            return False

        if not isinstance(resolved_heroes, list) or not isinstance(reports, list):
            continue
        hero_reports = [
            report
            for report in reports
            if isinstance(report, dict) and report.get("sourceKind") == "hero_skill"
        ]
        for resolved_hero in resolved_heroes:
            if not isinstance(resolved_hero, dict):
                continue
            display_name = str(resolved_hero.get("name", ""))
            instance_parts = str(resolved_hero.get("instanceId", "")).split(":")
            identities = {normalize_hero_name(display_name)}
            if len(instance_parts) > 1:
                identities.add(normalize_hero_name(instance_parts[1]))
            role = resolved_hero.get("role")
            source = army["joinerHeroes"] if role == "joiner" else army["heroes"]
            raw_name = next(
                (candidate for candidate in source if normalize_hero_name(candidate) in identities),
                None,
            )
            if raw_name is None:
                return False
            expected_levels = sorted(
                level
                for key, level in source[raw_name].items()
                if key.startswith("skill_") and level != 0
            )
            actual_levels = sorted(
                report["level"]
                for report in hero_reports
                if normalize_hero_name(str(report.get("heroName", "")))
                == normalize_hero_name(display_name)
            )
            if expected_levels != actual_levels:
                return False
    return True

def armies_from_retained_detail(detail: dict[str, Any]) -> dict[str, Any]:
    visibility = as_object(detail.get("visibility"))
    result = as_object(detail.get("result"))
    resolved = as_object(result.get("resolved"))
    skill_report = as_object(result.get("skillReport"))
    armies: dict[str, Any] = {}
    for side in ("attacker", "defender"):
        visible = as_object(visibility.get(side))
        resolved_heroes = as_object(resolved.get(side)).get("heroes")
        reports = skill_report.get(side)
        hero_reports = [
            report
            for report in reports
            if isinstance(report, dict) and report.get("sourceKind") == "hero_skill"
        ] if isinstance(reports, list) else []
        heroes: dict[str, dict[str, int | float]] = {}
        joiner_heroes: dict[str, dict[str, int | float]] = {}
        if isinstance(resolved_heroes, list):
            for hero in resolved_heroes:
                if not isinstance(hero, dict):
                    continue
                name = str(hero.get("name", ""))
                skill_ids = hero.get("skillIds")
                levels: dict[str, int | float] = {}
                if isinstance(skill_ids, list):
                    for offset, skill_id in enumerate(skill_ids, start=1):
                        level = next(
                            (
                                report.get("level")
                                for report in hero_reports
                                if normalize_hero_name(str(report.get("heroName", "")))
                                == normalize_hero_name(name)
                                and str(report.get("skillId", report.get("skillName")))
                                == str(skill_id)
                            ),
                            None,
                        )
                        if isinstance(level, (int, float)) and not isinstance(level, bool):
                            levels[f"skill_{offset}"] = level
                target = joiner_heroes if hero.get("role") == "joiner" else heroes
                target[name] = levels
        else:
            for name in visible.get("heroes", []):
                if isinstance(name, str):
                    heroes[name] = {}
        armies[side] = {
            "heroes": heroes,
            "joinerHeroes": joiner_heroes,
            "troops": numeric_record(visible.get("troops")),
        }
    return armies


class DefinitionResolver:
    def __init__(self, repo_root: Path) -> None:
        self.repo_root = repo_root
        self.current: dict[str, tuple[dict[str, Any], ...]] = {}
        self.versions: dict[str, tuple[SourceVersion, ...]] = {}
        self.resolved: dict[tuple[str, str, int, str], dict[str, Any] | None] = {}

    def resolve(
        self,
        file: str,
        expected_id: str,
        index: int,
        created_at: str,
        detail: dict[str, Any],
    ) -> dict[str, Any] | None:
        signature = json.dumps(
            {
                "visibility": detail.get("visibility"),
                "resolved": as_object(detail.get("result")).get("resolved"),
                "skillReport": as_object(detail.get("result")).get("skillReport"),
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        cache_key = (file, expected_id, index, signature)
        if cache_key in self.resolved:
            return self.resolved[cache_key]

        report_time = parse_time(created_at)
        versions = sorted(
            self._versions(file),
            key=lambda version: (
                version.created_at > report_time,
                abs((version.created_at - report_time).total_seconds()),
            ),
        )
        for version in versions:
            entry = find_entry(version.entries, expected_id, index)
            if entry is not None and definition_matches_detail(entry, detail):
                self.resolved[cache_key] = entry
                return entry

        current_entry = find_entry(self._current(file), expected_id, index)
        if current_entry is not None and definition_matches_detail(current_entry, detail):
            self.resolved[cache_key] = current_entry
            return current_entry

        self.resolved[cache_key] = None
        return None

    def _current(self, file: str) -> tuple[dict[str, Any], ...]:
        if file not in self.current:
            path = self.repo_root / file
            try:
                self.current[file] = entries_from_json(json.loads(path.read_text()))
            except (OSError, json.JSONDecodeError):
                self.current[file] = ()
        return self.current[file]

    def _versions(self, file: str) -> tuple[SourceVersion, ...]:
        if file in self.versions:
            return self.versions[file]
        log = subprocess.run(
            ["git", "log", "--all", "--format=%H%x09%cI", "--", file],
            cwd=self.repo_root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        versions: list[SourceVersion] = []
        seen_payloads: set[str] = set()
        for line in log.splitlines():
            commit, _, committed_at = line.partition("\t")
            if not commit or not committed_at:
                continue
            shown = subprocess.run(
                ["git", "show", f"{commit}:{file}"],
                cwd=self.repo_root,
                capture_output=True,
                text=True,
            )
            if shown.returncode != 0 or shown.stdout in seen_payloads:
                continue
            try:
                entries = entries_from_json(json.loads(shown.stdout))
            except json.JSONDecodeError:
                continue
            seen_payloads.add(shown.stdout)
            versions.append(SourceVersion(parse_time(committed_at), entries))
        self.versions[file] = tuple(versions)
        return self.versions[file]


def parse_time(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return datetime.now(timezone.utc)


def compatible_reports(reports_dir: Path) -> list[Path]:
    reports: list[Path] = []
    for path in sorted(reports_dir.glob("simulator_parity_*.json")):
        try:
            report = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if report.get("reportKind") == "simulator-parity-summary" and isinstance(report.get("testcases"), dict):
            reports.append(path)
    return reports


def atomic_json_write(path: Path, value: Any) -> None:
    stat = path.stat()
    with tempfile.NamedTemporaryFile("w", dir=path.parent, prefix=f".{path.name}.", delete=False) as handle:
        temporary = Path(handle.name)
        json.dump(value, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))


def preflight(
    reports: list[Path],
    reports_dir: Path,
    resolver: DefinitionResolver,
) -> tuple[
    dict[Path, dict[str, Any]],
    dict[Path, str],
    dict[str, int],
    list[str],
]:
    definitions: dict[Path, dict[str, Any]] = {}
    sources: dict[Path, str] = {}
    counts = {
        "reports": len(reports),
        "testcases": 0,
        "already_enriched": 0,
        "resolved": 0,
        "retained_fallback": 0,
    }
    unresolved: list[str] = []
    for report_path in reports:
        report = json.loads(report_path.read_text())
        created_at = str(report.get("createdAt", ""))
        for row in report["testcases"].values():
            counts["testcases"] += 1
            detail_ref = row.get("detailArtifact")
            if not isinstance(detail_ref, str):
                unresolved.append(f"{report_path.name}: {row.get('testcase_id')} has no detailArtifact")
                continue
            detail_path = reports_dir / detail_ref
            detail = json.loads(detail_path.read_text())
            existing = row.get("armies") or detail.get("armies")
            if isinstance(existing, dict):
                definitions[detail_path] = existing
                sources[detail_path] = str(
                    row.get("armiesSource", detail.get("armiesSource", "testcase"))
                )
                counts["already_enriched"] += 1
                continue
            entry = resolver.resolve(
                str(row.get("file", "")),
                str(row.get("testcase_id", "")),
                int(row.get("idx", 0)),
                created_at,
                detail,
            )
            if entry is None:
                definitions[detail_path] = armies_from_retained_detail(detail)
                sources[detail_path] = "retained-result"
                counts["retained_fallback"] += 1
                continue
            definitions[detail_path] = testcase_armies(entry)
            sources[detail_path] = "testcase"
            counts["resolved"] += 1
    return definitions, sources, counts, unresolved


def apply_backfill(
    reports: list[Path],
    reports_dir: Path,
    definitions: dict[Path, dict[str, Any]],
    sources: dict[Path, str],
) -> None:
    for report_path in reports:
        report = json.loads(report_path.read_text())
        for row in report["testcases"].values():
            detail_path = reports_dir / row["detailArtifact"]
            armies = definitions[detail_path]
            row["armies"] = armies
            row["armiesSource"] = sources[detail_path]
            detail = json.loads(detail_path.read_text())
            detail["armies"] = armies
            detail["armiesSource"] = sources[detail_path]
            atomic_json_write(detail_path, detail)
        atomic_json_write(report_path, report)


def main() -> int:
    args = parse_args()
    repo_root = args.repo_root.resolve()
    reports_dir = args.reports_dir.resolve()
    reports = compatible_reports(reports_dir)
    definitions, sources, counts, unresolved = preflight(
        reports,
        reports_dir,
        DefinitionResolver(repo_root),
    )
    print(json.dumps({**counts, "unresolved": len(unresolved), "write": args.write}, indent=2))
    if unresolved:
        for message in unresolved[:50]:
            print(message, file=sys.stderr)
        if len(unresolved) > 50:
            print(f"... {len(unresolved) - 50} more", file=sys.stderr)
        return 1
    if args.write:
        apply_backfill(reports, reports_dir, definitions, sources)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
