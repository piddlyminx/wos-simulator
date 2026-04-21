from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from Base_classes.Fight import Fight  # noqa: E402
from Base_classes.Fighter import Fighter  # noqa: E402
from Base_classes.Hero import Hero  # noqa: E402
from Base_classes.JsonUtil import JsonUtil  # noqa: E402
from Base_classes.StatsBonus import StatsBonus  # noqa: E402


BASE_STATS = {
    "inf": {"attack": 9.94, "defense": 9.44, "lethality": 1.75, "health": 1.75},
    "lanc": {"attack": 9.94, "defense": 9.44, "lethality": 1.75, "health": 1.75},
    "mark": {"attack": 10.43, "defense": 9.44, "lethality": 1.75, "health": 1.75},
}

BASE_TROOPS = {
    "infantry_t6": 500,
    "lancer_t6": 500,
    "marksman_t6": 500,
}


def make_fighter(name: str, heroes: dict | None = None) -> Fighter:
    fighter = Fighter(None, load_fighter_data=False)
    fighter.name = name
    fighter.stats = StatsBonus.from_dict(BASE_STATS)
    fighter.troops = BASE_TROOPS.copy()
    fighter.heroes = heroes or {}
    fighter.joiner_heroes = {}
    return fighter


class Gen7HeroSkillsTests(unittest.TestCase):
    def test_max_fighter_data_includes_gen7_heroes(self) -> None:
        JsonUtil.load_fighters_data(
            "fighters_data/fighters_stats.json",
            "fighters_data/fighters_heroes.json",
        )
        max_heroes = JsonUtil.fighter_heroes["max"]
        expected_stats = {
            "attack": 650.52,
            "defense": 650.52,
            "lethality": 160.5,
            "health": 160.5,
        }
        expected_levels = {"skill_1": 5, "skill_2": 5, "skill_3": 5, "skill_4": 5}

        for hero_name in ("Bradley", "Edith", "Gordon"):
            self.assertIn(hero_name, max_heroes)
            self.assertEqual(max_heroes[hero_name]["stats"], expected_stats)
            self.assertEqual(max_heroes[hero_name]["skill_levels"], expected_levels)

    def test_bradley_and_edith_are_registered_with_expected_shape(self) -> None:
        for hero_name in ("Bradley", "Edith"):
            self.assertIn(hero_name, JsonUtil.hero_registery)
            skills = JsonUtil.hero_registery[hero_name]
            self.assertEqual([skill["skill_num"] for skill in skills], [1, 2, 3, 4])

        bradley = JsonUtil.hero_registery["Bradley"]
        self.assertEqual(bradley[0]["skill_name"], "Veteran's Might")
        self.assertEqual(bradley[2]["skill_frequency"], {"frequency_type": "turn", "frequency_value": 4})
        self.assertEqual(bradley[3]["skill_effects"][0]["special"]["role"], "defense")

        edith = JsonUtil.hero_registery["Edith"]
        self.assertEqual(edith[0]["skill_name"], "Strategic Balance")
        self.assertEqual(
            [effect["effect_type"] for effect in edith[0]["skill_effects"]],
            ["DefenseUp", "DamageUp"],
        )
        self.assertEqual(edith[3]["skill_effects"][0]["special"]["stat"], "health")

    def test_explicit_skill_levels_are_accepted(self) -> None:
        levels = Hero.get_heroes_skill_levels(
            {
                "Bradley": {"skill_1": 5, "skill_2": 4, "skill_3": 3, "skill_4": 2},
                "Edith": {"skill_1": 4, "skill_2": 3, "skill_3": 2, "skill_4": 1},
                "Gordon": {"skill_1": 3, "skill_2": 2, "skill_3": 1, "skill_4": 5},
            },
            fighter_name=None,
        )

        self.assertEqual(levels["Bradley"], {"skill_1": 5, "skill_2": 4, "skill_3": 3, "skill_4": 2})
        self.assertEqual(levels["Edith"], {"skill_1": 4, "skill_2": 3, "skill_3": 2, "skill_4": 1})
        self.assertEqual(levels["Gordon"], {"skill_1": 3, "skill_2": 2, "skill_3": 1, "skill_4": 5})

    def test_gen7_deterministic_battle_smoke(self) -> None:
        bradley_fight = Fight(
            make_fighter("att"),
            make_fighter(
                "def",
                {"Bradley": {"skill_1": 5, "skill_2": 5, "skill_3": 5, "skill_4": 5}},
            ),
            dont_save=True,
        )
        self.assertEqual(bradley_fight.battle(), (0, 1058))

        edith_fight = Fight(
            make_fighter("att"),
            make_fighter(
                "def",
                {"Edith": {"skill_1": 5, "skill_2": 5, "skill_3": 5, "skill_4": 5}},
            ),
            dont_save=True,
        )
        self.assertEqual(edith_fight.battle(), (0, 1051))

        gordon_fight = Fight(
            make_fighter(
                "att",
                {"Gordon": {"skill_1": 5, "skill_2": 5, "skill_3": 5, "skill_4": 5}},
            ),
            make_fighter("def"),
            dont_save=True,
        )
        self.assertEqual(gordon_fight.battle(), (1113, 0))


if __name__ == "__main__":
    unittest.main()
