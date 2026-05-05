"""Unit + integration tests for dashboard.ocr_report.

Covers:
  - Parsing helpers (_parse_stat_row_from_text, _match_stat_label).
  - Linear-fit band prediction for missing stat rows.
  - Dashboard adapter mapping for the skill parser result shape.

"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dashboard.ocr_report import (  # noqa: E402
    STAT_ROW_ORDER,
    _linear_fit,
    _match_stat_label,
    _parse_stat_row_from_text,
    _parse_stats,
    _parse_troop_row,
    _shape_skill_side,
    _warnings_from_skill_result,
    predict_missing_row_bands,
)


class ParseStatRowTests(unittest.TestCase):
    def test_plain_row(self) -> None:
        got = _parse_stat_row_from_text("+1736.7% Infantry Attack +2045.0%")
        self.assertEqual(got, (("infantry", "attack"), (1736.7, 2045.0)))

    def test_missing_space_between_label_parts(self) -> None:
        got = _parse_stat_row_from_text("+1746.4% = InfantryDefense +2039.2%")
        self.assertEqual(got, (("infantry", "defense"), (1746.4, 2039.2)))

    def test_dropped_plus_sign(self) -> None:
        got = _parse_stat_row_from_text("1769.2% Lancer Attack 1944.2%")
        self.assertEqual(got, (("lancer", "attack"), (1769.2, 1944.2)))

    def test_trailing_noise_ignored(self) -> None:
        got = _parse_stat_row_from_text("+2285.5% LancerLethality +2068.8% >")
        self.assertEqual(got, (("lancer", "lethality"), (2285.5, 2068.8)))

    def test_non_stat_line_rejected(self) -> None:
        self.assertIsNone(_parse_stat_row_from_text("™_ Stat/Bonuses Oo"))
        self.assertIsNone(
            _parse_stat_row_from_text("759,030 89,713 867,177 731,618 319,320 433,214")
        )


class MatchStatLabelTests(unittest.TestCase):
    def test_exact(self) -> None:
        self.assertEqual(_match_stat_label("Infantry Attack"), ("infantry", "attack"))

    def test_no_space(self) -> None:
        self.assertEqual(_match_stat_label("LancerLethality"), ("lancer", "lethality"))

    def test_with_punctuation(self) -> None:
        self.assertEqual(_match_stat_label("Marksman:Health!"), ("marksman", "health"))

    def test_unknown(self) -> None:
        self.assertIsNone(_match_stat_label("Cavalry Dread"))


class LinearFitTests(unittest.TestCase):
    def test_two_points(self) -> None:
        slope, intercept = _linear_fit([(0.0, 100.0), (4.0, 300.0)])  # type: ignore[misc]
        self.assertAlmostEqual(slope, 50.0)
        self.assertAlmostEqual(intercept, 100.0)

    def test_insufficient_points(self) -> None:
        self.assertIsNone(_linear_fit([(0.0, 100.0)]))

    def test_degenerate(self) -> None:
        self.assertIsNone(_linear_fit([(1.0, 50.0), (1.0, 60.0)]))


class PredictMissingRowBandsTests(unittest.TestCase):
    def test_interior_row_missing(self) -> None:
        # Simulate primary pass finding 11 of 12 rows with 60-px spacing
        # starting at y=100. The missing row is ("infantry", "lethality")
        # which is index 2 -> expected center y = 100 + 2*60 = 220.
        found: dict[tuple[str, str], float] = {}
        for i, key in enumerate(STAT_ROW_ORDER):
            if key == ("infantry", "lethality"):
                continue
            found[key] = 100.0 + i * 60.0
        bands = predict_missing_row_bands(
            found, [("infantry", "lethality")], img_height=1000
        )
        self.assertEqual(len(bands), 1)
        key, top, bot = bands[0]
        self.assertEqual(key, ("infantry", "lethality"))
        center = (top + bot) / 2
        self.assertAlmostEqual(center, 220.0, delta=2.0)
        # Band should straddle the predicted row with generous padding.
        self.assertGreater(bot - top, 40)

    def test_no_found_rows_returns_nothing(self) -> None:
        self.assertEqual(
            predict_missing_row_bands({}, list(STAT_ROW_ORDER), img_height=1000), []
        )


class ParseStatsPositionsTests(unittest.TestCase):
    def test_center_y_tracks_line_midpoint(self) -> None:
        lines = [
            {"text": "+1736.7% Infantry Attack +2045.0%", "top": 100, "bottom": 120},
            {"text": "+1746.4% Infantry Defense +2039.2%", "top": 160, "bottom": 180},
        ]
        stats, center_y, warnings = _parse_stats(lines)  # type: ignore[arg-type]
        self.assertEqual(stats[("infantry", "attack")], (1736.7, 2045.0))
        self.assertEqual(center_y[("infantry", "attack")], 110.0)
        self.assertEqual(center_y[("infantry", "defense")], 170.0)
        self.assertEqual(warnings, [])

    def test_duplicate_row_keeps_first_and_warns(self) -> None:
        lines = [
            {"text": "+1736.7% Infantry Attack +2045.0%", "top": 100, "bottom": 120},
            {"text": "+9999.0% InfantryAttack +8888.0%", "top": 500, "bottom": 520},
        ]
        stats, _center_y, warnings = _parse_stats(lines)  # type: ignore[arg-type]
        self.assertEqual(stats[("infantry", "attack")], (1736.7, 2045.0))
        self.assertTrue(any("duplicate" in w for w in warnings))


class ParseTroopRowTests(unittest.TestCase):
    @staticmethod
    def _word(text: str, left: int, right: int) -> dict[str, int | str]:
        return {"text": text, "left": left, "right": right, "top": 0, "bottom": 10}

    def test_partial_team_maps_left_to_right_per_side(self) -> None:
        line = {
            "text": "143,939 104,233 38,432 19,262 127,047",
            "top": 10,
            "bottom": 20,
            "words": [
                self._word("143,939", 20, 90),
                self._word("104,233", 100, 180),
                self._word("38,432", 420, 490),
                self._word("19,262", 500, 570),
                self._word("127,047", 580, 670),
            ],
        }
        counts, warnings, status = _parse_troop_row(line, mid_x=350.0)  # type: ignore[arg-type]
        self.assertEqual(counts["attacker"], [143_939, 104_233])
        self.assertEqual(counts["defender"], [38_432, 19_262, 127_047])
        self.assertEqual(status, "partial")
        self.assertIn(
            "attacker side has 2 troop counts, mapped left->right as [infantry, lancer]; verify mapping.",
            warnings,
        )

    def test_percentage_row_is_left_blank_with_warning(self) -> None:
        line = {
            "text": "46.00% 16.00% 38.00% 33.33% 33.33% 33.33%",
            "top": 10,
            "bottom": 20,
            "words": [
                self._word("46.00%", 20, 80),
                self._word("16.00%", 100, 160),
            ],
        }
        counts, warnings, status = _parse_troop_row(line, mid_x=350.0)  # type: ignore[arg-type]
        self.assertEqual(counts, {"attacker": [], "defender": []})
        self.assertEqual(status, "percentage")
        self.assertEqual(
            warnings,
            [
                "troop row shows percentages rather than absolute counts; troop counts were left blank. Populate them manually or retry with a report that shows absolute troop numbers."
            ],
        )

    def test_split_words_can_merge_into_one_count(self) -> None:
        line = {
            "text": "91,728 14 112 70,560 60 666 60,666 60.666",
            "top": 10,
            "bottom": 20,
            "words": [
                self._word("91,728", 20, 90),
                self._word("14", 100, 120),
                self._word("112", 124, 160),
                self._word("70,560", 180, 250),
                self._word("60", 420, 440),
                self._word("666", 444, 480),
                self._word("60,666", 500, 570),
                self._word("60.666", 590, 660),
            ],
        }
        counts, warnings, status = _parse_troop_row(line, mid_x=350.0)  # type: ignore[arg-type]
        self.assertEqual(
            counts,
            {
                "attacker": [91_728, 14_112, 70_560],
                "defender": [60_666, 60_666, 60_666],
            },
        )
        self.assertEqual(status, "ok")
        self.assertEqual(warnings, [])


class SkillParserAdapterTests(unittest.TestCase):
    def test_maps_typed_partial_troops_and_stats(self) -> None:
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

        result = _shape_skill_side(side)

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

    def test_maps_level_fallback_when_typed_troop_lacks_tier(self) -> None:
        side = {
            "troops": [{"type": "lancer", "tier": None, "count": 600}],
            "troop_counts": {"lancer": 600},
            "levels": {"lancer": {"tier": 9, "fire_crystal_level": None}},
            "stat_bonuses": {},
        }

        result = _shape_skill_side(side)

        self.assertEqual(result["troops"]["lancer"], 600)
        self.assertEqual(result["troop_types"]["lancer"], "lancer_t9")

    def test_missing_fields_become_dashboard_warning(self) -> None:
        warnings = _warnings_from_skill_result(
            {"meta": {"missing_fields": ["left_lancer_count", "right_marksman_tier"]}}
        )

        self.assertEqual(
            warnings,
            ["missing fields: left_lancer_count, right_marksman_tier"],
        )


if __name__ == "__main__":
    unittest.main()
