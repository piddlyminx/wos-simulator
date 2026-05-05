import json
from types import SimpleNamespace

from Base_classes.Fight import Fight


def test_save_testcase_does_not_persist_sim_result(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr("builtins.input", lambda _: "yes")
    (tmp_path / "testcases").mkdir()

    fight = Fight.__new__(Fight)
    fight.attacker = SimpleNamespace(name="attacker")
    fight.defender = SimpleNamespace(name="defender")
    fight.num_rounds = 1

    monkeypatch.setattr(
        fight,
        "battle_report",
        lambda: {
            "attacker": {"troops": {"infantry_t6": 1}},
            "defender": {"troops": {"infantry_t6": 1}},
            "sim_result": {"attacker": 1, "defender": 0},
            "sim_rounds": 1,
        },
    )

    fight.save_testcase("saved.json", [{"attacker": 1, "defender": 0}])

    saved = json.loads((tmp_path / "testcases" / "saved.json").read_text())
    assert "sim_result" not in saved[0]
    assert saved[0]["game_report_result"] == [{"attacker": 1, "defender": 0}]
