from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from Base_classes.Hero import Hero  # noqa: E402
from Base_classes.JsonUtil import JsonUtil  # noqa: E402


class GordonHeroSkillsTests(unittest.TestCase):
    def test_gordon_is_registered_with_expected_skill_shape(self) -> None:
        self.assertIn("Gordon", JsonUtil.hero_registery)

        skills = JsonUtil.hero_registery["Gordon"]
        self.assertEqual([skill["skill_num"] for skill in skills], [1, 2, 3, 4])

        venom = skills[0]
        self.assertEqual(venom["skill_name"], "Venom Infusion")
        self.assertEqual(venom["skill_frequency"], {"frequency_type": "attack", "frequency_value": 2})
        self.assertEqual(len(venom["skill_effects"]), 2)
        self.assertTrue(venom["skill_effects"][0]["extra_attack"])
        self.assertEqual(venom["skill_effects"][1]["effect_type"], "OppDamageDown")
        self.assertEqual(venom["skill_effects"][1]["benefit_types"]["benefit_vs"], "target")

        toxic_release = skills[2]
        self.assertEqual(toxic_release["skill_frequency"], {"frequency_type": "turn", "frequency_value": 4})
        self.assertEqual(
            [effect["benefit_types"]["benefit_vs"] for effect in toxic_release["skill_effects"]],
            ["infantry", "marksman"],
        )

    def test_explicit_skill_levels_are_accepted(self) -> None:
        levels = Hero.get_heroes_skill_levels(
            {"Gordon": {"skill_1": 5, "skill_2": 4, "skill_3": 3, "skill_4": 2}},
            fighter_name=None,
        )

        self.assertEqual(levels["Gordon"]["skill_1"], 5)
        self.assertEqual(levels["Gordon"]["skill_2"], 4)
        self.assertEqual(levels["Gordon"]["skill_3"], 3)
        self.assertEqual(levels["Gordon"]["skill_4"], 2)


if __name__ == "__main__":
    unittest.main()
