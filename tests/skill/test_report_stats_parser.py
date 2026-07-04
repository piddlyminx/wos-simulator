from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "skill" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import report_stats_parser
from report_stats_parser import (
    STAT_NAMES,
    TROOP_TYPES,
    dashboard_warnings_from_result,
    extract_report_stats_and_troops,
    extract_values_from_ocr_items,
    shape_dashboard_report_result,
    shape_dashboard_side,
)


class ReportStatsParserTests(unittest.TestCase):
    def test_dashboard_adapter_maps_typed_partial_troops_and_stats(self) -> None:
        side = {
            "troops": [
                {
                    "type": "infantry",
                    "tier": 11,
                    "fire_crystal_level": 3,
                    "count": 1200,
                },
                {
                    "type": "marksman",
                    "tier": 10,
                    "fire_crystal_level": 0,
                    "count": 800,
                },
            ],
            "troop_counts": {"infantry": 1200, "marksman": 800},
            "levels": {},
            "stat_bonuses": {
                "infantry_attack": 113.5,
                "lancer_health": 124.0,
                "marksman_lethality": 1073.0,
            },
        }

        result = shape_dashboard_side(side)

        self.assertEqual(
            result["troops"],
            {"infantry": 1200, "lancer": None, "marksman": 800},
        )
        self.assertEqual(
            result["troop_types"],
            {
                "infantry": "infantry_t11_fc3",
                "lancer": None,
                "marksman": "marksman_t10",
            },
        )
        self.assertEqual(result["stats"]["infantry"]["attack"], 113.5)
        self.assertEqual(result["stats"]["lancer"]["health"], 124.0)
        self.assertEqual(result["stats"]["marksman"]["lethality"], 1073.0)
        self.assertIsNone(result["stats"]["lancer"]["attack"])

    def test_dashboard_adapter_maps_level_fallback_when_typed_troop_lacks_tier(self) -> None:
        side = {
            "troops": [{"type": "lancer", "tier": None, "count": 600}],
            "troop_counts": {"lancer": 600},
            "levels": {"lancer": {"tier": 9, "fire_crystal_level": None}},
            "stat_bonuses": {},
        }

        result = shape_dashboard_side(side)

        self.assertEqual(result["troops"]["lancer"], 600)
        self.assertEqual(result["troop_types"]["lancer"], "lancer_t9")

    def test_dashboard_report_shapes_absent_parsed_troop_slots_as_zero(self) -> None:
        result = {
            "left": {
                "troops": [{"type": "infantry", "tier": 11, "count": 1200}],
                "troop_counts": {"infantry": 1200},
                "levels": {"infantry": {"tier": 11, "fire_crystal_level": 0}},
                "stat_bonuses": {},
            },
            "right": {
                "troops": [{"type": "marksman", "tier": 10, "count": 800}],
                "troop_counts": {"marksman": 800},
                "levels": {"marksman": {"tier": 10, "fire_crystal_level": 0}},
                "stat_bonuses": {},
            },
            "meta": {"troop_slots_present": True, "missing_fields": []},
        }

        shaped = shape_dashboard_report_result(result)

        self.assertEqual(
            shaped["attacker"]["troops"],
            {"infantry": 1200, "lancer": 0, "marksman": 0},
        )
        self.assertEqual(
            shaped["defender"]["troops"],
            {"infantry": 0, "lancer": 0, "marksman": 800},
        )

    def test_dashboard_adapter_missing_fields_become_warning(self) -> None:
        warnings = dashboard_warnings_from_result(
            {"meta": {"missing_fields": ["left_lancer_count", "right_marksman_tier"]}}
        )

        self.assertEqual(
            warnings,
            ["missing fields: left_lancer_count, right_marksman_tier"],
        )

    def test_extracts_stats_counts_and_tier_from_ocr_items(self) -> None:
        items = [
            {"text": "Lv.11.0", "x1": 33, "y1": 124, "x2": 97, "y2": 144, "confidence": 0.93},
            {"text": "Lv.11.3", "x1": 135, "y1": 122, "x2": 207, "y2": 145, "confidence": 0.95},
            {"text": "Lv.10.5", "x1": 229, "y1": 124, "x2": 303, "y2": 143, "confidence": 0.96},
            {"text": "Lv.10.0", "x1": 414, "y1": 124, "x2": 480, "y2": 143, "confidence": 0.97},
            {"text": "Lv.10.4", "x1": 517, "y1": 124, "x2": 582, "y2": 144, "confidence": 0.98},
            {"text": "Lv.9.0", "x1": 617, "y1": 121, "x2": 686, "y2": 144, "confidence": 0.95},
            {"text": "96,000", "x1": 25, "y1": 149, "x2": 103, "y2": 172, "confidence": 0.99},
            {"text": "36,000", "x1": 129, "y1": 149, "x2": 206, "y2": 172, "confidence": 0.98},
            {"text": "56,200", "x1": 231, "y1": 149, "x2": 307, "y2": 172, "confidence": 0.99},
            {"text": "61,866", "x1": 410, "y1": 149, "x2": 484, "y2": 172, "confidence": 0.97},
            {"text": "61,868", "x1": 513, "y1": 149, "x2": 585, "y2": 172, "confidence": 0.97},
            {"text": "61,866", "x1": 615, "y1": 148, "x2": 687, "y2": 171, "confidence": 0.98},
            {"text": "Stat Bonuses", "x1": 267, "y1": 214, "x2": 449, "y2": 249, "confidence": 0.99},
        ]
        y = 279
        for troop_type in ("Infantry", "Lancer", "Marksman"):
            for stat in ("Attack", "Defense", "Lethality", "Health"):
                items.extend(
                    [
                        {"text": "+219.0%", "x1": 114, "y1": y, "x2": 215, "y2": y + 26, "confidence": 1.0},
                        {"text": f"{troop_type} {stat}", "x1": 250, "y1": y, "x2": 465, "y2": y + 28, "confidence": 0.99},
                        {"text": "+242.0%", "x1": 496, "y1": y, "x2": 604, "y2": y + 26, "confidence": 1.0},
                    ]
                )
                y += 60

        result = extract_values_from_ocr_items(items, image_width=707, image_height=1195)

        self.assertEqual(result["left"]["troop_counts"], {"infantry": 96000, "lancer": 36000, "marksman": 56200})
        self.assertEqual(result["right"]["troop_counts"], {"infantry": 61866, "lancer": 61868, "marksman": 61866})
        self.assertEqual(result["left"]["levels"]["infantry"], {"tier": 11, "fire_crystal_level": None})
        self.assertEqual(result["left"]["levels"]["lancer"], {"tier": 11, "fire_crystal_level": None})
        self.assertEqual(result["left"]["levels"]["marksman"], {"tier": 10, "fire_crystal_level": None})
        self.assertEqual(result["right"]["levels"]["marksman"], {"tier": 9, "fire_crystal_level": None})
        self.assertEqual(len(result["left"]["stat_bonuses"]), 12)
        self.assertEqual(len(result["right"]["stat_bonuses"]), 12)
        self.assertEqual(result["meta"]["missing_fields"], [])

    def test_dashboard_report_fixtures_parse_all_values(self) -> None:
        expected_by_report = json.loads((ROOT / "tests" / "fixtures" / "dashboard_report_expected.json").read_text())
        report_dir = ROOT / "dashboard" / "test_reports"
        report_paths = sorted(
            path
            for pattern in ("*.png", "*.jpg", "*.jpeg")
            for path in report_dir.glob(pattern)
        )
        self.assertEqual([path.name for path in report_paths], sorted(path.name for path in report_paths))
        self.assertEqual(set(path.name for path in report_paths), set(expected_by_report))

        for path in report_paths:
            with self.subTest(path=path.name):
                expected = expected_by_report[path.name]
                result = extract_report_stats_and_troops(path)
                for side in ("left", "right"):
                    typed_troops = {item["type"]: item for item in result[side]["troops"]}
                    for troop_type in TROOP_TYPES:
                        expected_troop = expected[side]["troops"][troop_type]
                        actual_troop = typed_troops.get(troop_type)
                        actual = {
                            "count": None if actual_troop is None else actual_troop.get("count"),
                            "tier": None if actual_troop is None else actual_troop.get("tier"),
                            "fire_crystal_level": (
                                None if actual_troop is None else actual_troop.get("fire_crystal_level", 0)
                            ),
                        }
                        self.assertEqual(actual, expected_troop, f"{side} {troop_type}")

                    for troop_type in TROOP_TYPES:
                        for stat_name in STAT_NAMES:
                            field = f"{troop_type}_{stat_name}"
                            self.assertEqual(
                                result[side]["stat_bonuses"].get(field),
                                expected[side]["stat_bonuses"][field],
                                f"{side} {field}",
                            )
                self.assertEqual(result["meta"]["missing_fields"], [])

    def test_dashboard_report_fixture_rejects_negative_stat_ocr(self) -> None:
        path = ROOT / "dashboard" / "test_reports" / "WOS-278-negative-marksman-defense.png"

        result = extract_report_stats_and_troops(path)

        self.assertEqual(result["left"]["stat_bonuses"]["marksman_defense"], 219.0)
        self.assertTrue(all(value >= 0 for value in result["left"]["stat_bonuses"].values()))
        self.assertEqual(result["meta"]["missing_fields"], [])

    def test_troop_count_extraction_splits_adjacent_ocr_numbers(self) -> None:
        items = [
            {"text": "Lv. 10.4", "x1": 406, "y1": 99, "x2": 475, "y2": 122, "confidence": 0.95},
            {"text": "Lv. 10.0", "x1": 510, "y1": 100, "x2": 578, "y2": 121, "confidence": 0.95},
            {"text": "Lv. 10.0", "x1": 607, "y1": 98, "x2": 680, "y2": 123, "confidence": 0.95},
            {"text": "1,005,074 320,200", "x1": 395, "y1": 127, "x2": 588, "y2": 150, "confidence": 0.9},
            {"text": "14,730", "x1": 608, "y1": 124, "x2": 682, "y2": 153, "confidence": 0.9},
            {"text": "34", "x1": 631, "y1": 60, "x2": 649, "y2": 70, "confidence": 0.9},
            {"text": "Stat Bonuses", "x1": 267, "y1": 183, "x2": 449, "y2": 218, "confidence": 0.99},
        ]
        y = 248
        for troop_type in ("Infantry", "Lancer", "Marksman"):
            for stat in ("Attack", "Defense", "Lethality", "Health"):
                items.extend(
                    [
                        {"text": "+1.0%", "x1": 114, "y1": y, "x2": 215, "y2": y + 26, "confidence": 1.0},
                        {"text": f"{troop_type} {stat}", "x1": 250, "y1": y, "x2": 465, "y2": y + 28, "confidence": 0.99},
                        {"text": "+2.0%", "x1": 496, "y1": y, "x2": 604, "y2": y + 26, "confidence": 1.0},
                    ]
                )
                y += 40

        result = extract_values_from_ocr_items(items, image_width=720, image_height=1280)

        self.assertEqual(
            result["right"]["troop_counts"],
            {"infantry": 1005074, "lancer": 320200, "marksman": 14730},
        )

    def test_extracts_stats_only_panel_without_stat_bonuses_header(self) -> None:
        items = [
            {"text": "My Stats", "x1": 18, "y1": 31, "x2": 147, "y2": 79, "confidence": 0.99},
            {"text": "Opponent's Stats", "x1": 467, "y1": 32, "x2": 690, "y2": 75, "confidence": 0.98},
        ]
        y = 103
        rows = [
            ("Infantry Attack", "+113.5%", "+124.0%"),
            ("Infantry Defense", "+113.5%", "+124.0%"),
            ("Infantry Lethality", "+1044.8%", "+1073.0%"),
            ("Infantry Health", "+1044.8%", "+1073.0%"),
            ("Lancer Attack", "+113.5%", "+124.0%"),
            ("Lancer Defense", "+113.5%", "+124.0%"),
            ("Lancer Lethality", "+933.3%", "+1073.0%"),
            ("Lancer Health", "+933.3%", "+1073.0%"),
            ("Marksman Attack", "+113.5%", "+124.0%"),
            ("Marksman Defense", "+113.5%", "+124.0%"),
            ("Marksman Lethality", "+1048.6%", "+1073.0%"),
            ("Marksman Health", "+1048.6%", "+1073.0%"),
        ]
        for label, left, right in rows:
            items.extend(
                [
                    {"text": left, "x1": 30, "y1": y, "x2": 151, "y2": y + 29, "confidence": 1.0},
                    {"text": label, "x1": 240, "y1": y, "x2": 470, "y2": y + 33, "confidence": 1.0},
                    {"text": right, "x1": 565, "y1": y, "x2": 683, "y2": y + 29, "confidence": 1.0},
                ]
            )
            y += 70

        result = extract_values_from_ocr_items(items, image_width=712, image_height=932)

        self.assertFalse(result["meta"]["troop_slots_present"])
        self.assertEqual(result["left"]["troop_counts"], {})
        self.assertEqual(result["right"]["troop_counts"], {})
        self.assertEqual(result["left"]["stat_bonuses"]["infantry_lethality"], 1044.8)
        self.assertEqual(result["left"]["stat_bonuses"]["marksman_health"], 1048.6)
        self.assertEqual(result["right"]["stat_bonuses"]["marksman_health"], 1073.0)
        self.assertEqual(
            result["meta"]["missing_fields"],
            [
                "left_infantry_count",
                "left_infantry_tier",
                "left_lancer_count",
                "left_lancer_tier",
                "left_marksman_count",
                "left_marksman_tier",
                "right_infantry_count",
                "right_infantry_tier",
                "right_lancer_count",
                "right_lancer_tier",
                "right_marksman_count",
                "right_marksman_tier",
            ],
        )

    def test_stats_only_repair_does_not_require_troop_level_rows(self) -> None:
        result = {
            "left": {
                "troop_counts": {},
                "levels": {},
                "stat_bonuses": {"infantry_attack": 113.5},
            },
            "right": {
                "troop_counts": {},
                "levels": {},
                "stat_bonuses": {"infantry_attack": 124.0},
            },
            "meta": {
                "header_box": {
                    "text": "stats-panel",
                    "x1": 0,
                    "y1": 80,
                    "x2": 712,
                    "y2": 100,
                    "confidence": 1.0,
                },
                "label_boxes": {},
                "troop_slots_present": False,
                "missing_fields": ["left_infantry_count"],
            },
        }

        with patch.object(report_stats_parser, "_ocr_crop_texts", return_value=[]):
            repaired = report_stats_parser._repair_missing_values(
                result,
                np.zeros((932, 712, 3), dtype=np.uint8),
            )

        self.assertEqual(repaired["left"]["troop_counts"], {})
        self.assertEqual(repaired["right"]["levels"], {})
        self.assertIn("left_infantry_count", repaired["meta"]["missing_fields"])
        self.assertNotIn("left_infantry_attack", repaired["meta"]["missing_fields"])


if __name__ == "__main__":
    unittest.main()
