from dashboard.optimize_ratio import (
    _effective_search_replicates,
    _has_active_heroes_or_joiners,
)


def test_no_hero_search_uses_one_effective_replicate():
    side = {
        "heroes": {
            "infantry": {"name": None, "skills": [0, 0, 0, 0]},
            "lancer": {"name": None, "skills": [0, 0, 0, 0]},
            "marksman": {"name": None, "skills": [0, 0, 0, 0]},
        },
        "joiners": [],
    }

    assert not _has_active_heroes_or_joiners(side, rally_mode=False)
    assert _effective_search_replicates(side, side, False, 20) == 1


def test_active_hero_keeps_requested_replicates():
    attacker = {
        "heroes": {
            "infantry": {"name": "Molly", "skills": [5, 5, 5, 0]},
        },
        "joiners": [],
    }
    defender = {"heroes": {}, "joiners": []}

    assert _has_active_heroes_or_joiners(attacker, rally_mode=False)
    assert _effective_search_replicates(attacker, defender, False, 20) == 20


def test_rally_joiner_keeps_requested_replicates():
    attacker = {"heroes": {}, "joiners": [{"name": "Jessie"}]}
    defender = {"heroes": {}, "joiners": []}

    assert _has_active_heroes_or_joiners(attacker, rally_mode=True)
    assert _effective_search_replicates(attacker, defender, True, 20) == 20
