"""Unit + integration tests for dashboard.ocr_report.

Covers:
  - Parsing helpers (_parse_stat_row_from_text, _match_stat_label).
  - Linear-fit band prediction for missing stat rows.
  - End-to-end retry: a slightly-faded stat row that the primary PSM 6
    pass misses but the hardened retry path recovers.

The end-to-end test depends on having the tesseract binary installed. It
is skipped automatically when tesseract is missing.
"""

from __future__ import annotations

import io
import shutil
import sys
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dashboard.ocr_report import (  # noqa: E402
    STAT_ROW_ORDER,
    _linear_fit,
    _match_stat_label,
    _parse_stat_row_from_text,
    _parse_stats,
    _parse_troop_row,
    parse_report,
    predict_missing_row_bands,
)


FIXTURES = Path(__file__).parent / "fixtures"
STAT_BONUSES_PNG = FIXTURES / "stat_bonuses.png"
DASHBOARD_REPORTS = Path(__file__).resolve().parents[1] / "dashboard" / "test_reports"

TESSERACT_AVAILABLE = shutil.which("tesseract") is not None


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


@unittest.skipUnless(
    TESSERACT_AVAILABLE and STAT_BONUSES_PNG.exists(),
    "tesseract binary or fixture image unavailable",
)
class ParseReportIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.image_bytes = STAT_BONUSES_PNG.read_bytes()

    def test_clean_image_parses_all_rows(self) -> None:
        result = parse_report(self.image_bytes)
        self.assertFalse(result["ocr_retried"])
        self.assertFalse(
            any("missing stat rows" in warning for warning in result["warnings"])
        )
        for cat in ("infantry", "lancer", "marksman"):
            for stat in ("attack", "defense", "lethality", "health"):
                self.assertIsNotNone(
                    result["attacker"]["stats"][cat][stat],
                    f"attacker {cat} {stat} should be populated",
                )
                self.assertIsNotNone(
                    result["defender"]["stats"][cat][stat],
                    f"defender {cat} {stat} should be populated",
                )

    def test_faded_row_recovered_by_retry(self) -> None:
        """Fade the Infantry Lethality row until primary PSM 6 misses it.

        The hardened retry path must recover the value silently.
        """
        img = Image.open(io.BytesIO(self.image_bytes)).convert("RGB")
        # Infantry Lethality is the 3rd stat row. In this fixture it sits at
        # roughly y=280-315. Blend with the background tan color to drop its
        # contrast below PSM 6's detection floor while keeping pixels readable.
        row = img.crop((0, 278, img.width, 315))
        overlay = Image.new("RGB", row.size, (246, 232, 200))
        from PIL import Image as _PIL  # local import to satisfy linters

        blended = _PIL.blend(row, overlay, 0.70)
        img.paste(blended, (0, 278))
        buf = io.BytesIO()
        img.save(buf, format="PNG")

        result = parse_report(buf.getvalue())

        self.assertTrue(
            result["ocr_retried"],
            "retry path should have been triggered by faded row",
        )
        self.assertFalse(
            any("missing stat rows" in warning for warning in result["warnings"]),
            f"expected silent stat recovery, got: {result['warnings']}",
        )
        self.assertIsNotNone(
            result["attacker"]["stats"]["infantry"]["lethality"],
            "infantry lethality should have been recovered by the retry",
        )

    @unittest.skipUnless(
        DASHBOARD_REPORTS.exists(),
        "dashboard/test_reports unavailable",
    )
    def test_troop_row_recovery_uses_header_anchored_band(self) -> None:
        result = parse_report(
            (DASHBOARD_REPORTS / "Screenshot 2026-03-20 005937.png").read_bytes()
        )
        self.assertEqual(
            result["attacker"]["troops"],
            {"infantry": 91_728, "lancer": 14_112, "marksman": 70_560},
        )
        self.assertEqual(
            result["defender"]["troops"],
            {"infantry": 60_666, "lancer": 60_666, "marksman": 60_666},
        )
        self.assertEqual(result["warnings"], [])

    @unittest.skipUnless(
        DASHBOARD_REPORTS.exists(),
        "dashboard/test_reports unavailable",
    )
    def test_partial_troop_rows_warn_but_keep_stat_parse(self) -> None:
        result = parse_report(
            (DASHBOARD_REPORTS / "Screenshot 2026-04-20 050746.png").read_bytes()
        )
        self.assertEqual(
            result["attacker"]["troops"],
            {"infantry": 143_939, "lancer": 104_233, "marksman": None},
        )
        self.assertEqual(
            result["defender"]["troops"],
            {"infantry": 38_432, "lancer": 19_262, "marksman": 127_047},
        )
        self.assertIn(
            "attacker side has 2 troop counts, mapped left->right as [infantry, lancer]; verify mapping.",
            result["warnings"],
        )
        self.assertNotIn(
            "could not parse troop counts from the row above 'Stat Bonuses'; populate them manually or retry with a clearer crop",
            result["warnings"],
        )


@unittest.skipUnless(
    TESSERACT_AVAILABLE and DASHBOARD_REPORTS.exists(),
    "tesseract binary or dashboard/test_reports unavailable",
)
class DashboardReportCorpusTests(unittest.TestCase):
    def test_dashboard_report_corpus_parses_cleanly(self) -> None:
        report_paths = sorted(
            p for p in DASHBOARD_REPORTS.iterdir()
            if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
        )
        self.assertGreater(len(report_paths), 0, "no dashboard report images found")

        failures: list[str] = []
        for report_path in report_paths:
            try:
                result = parse_report(report_path.read_bytes())
            except Exception as exc:  # noqa: BLE001
                failures.append(f"{report_path.name}: exception: {exc}")
                continue

            missing_stats: list[str] = []
            missing_troops: list[str] = []
            for side in ("attacker", "defender"):
                troops = result[side]["troops"]
                for cat, val in troops.items():
                    if val is None:
                        missing_troops.append(f"{side}.troops.{cat}")
                for cat, stats in result[side]["stats"].items():
                    for stat, val in stats.items():
                        if val is None:
                            missing_stats.append(f"{side}.stats.{cat}.{stat}")

            warnings = result["warnings"]
            generic_troop_failures = [
                warning
                for warning in warnings
                if warning.startswith("could not parse troop counts")
            ]
            unexpected_warnings = [
                warning
                for warning in warnings
                if not (
                    warning.startswith("attacker side has ")
                    or warning.startswith("defender side has ")
                    or warning.startswith(
                        "troop row shows percentages rather than absolute counts"
                    )
                )
            ]

            if missing_stats or generic_troop_failures or unexpected_warnings:
                missing_text = ", ".join(missing_stats + missing_troops) if (missing_stats or missing_troops) else "none"
                failures.append(
                    f"{report_path.name}: warnings={warnings!r}; missing={missing_text}"
                )
                continue

            if missing_troops and not any("verify mapping" in warning for warning in warnings):
                failures.append(
                    f"{report_path.name}: missing troop counts without mapping warning: {', '.join(missing_troops)}"
                )

        if failures:
            self.fail(
                f"{len(failures)}/{len(report_paths)} dashboard screenshots did not parse cleanly:\n"
                + "\n".join(failures)
            )


if __name__ == "__main__":
    unittest.main()
