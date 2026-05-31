# Archived — v1 Python Battle Simulator

> **Status: archived.** This is the original Python battle simulator by
> [1589] HIT-Ryo. It has been **superseded by the TypeScript simulator in
> [`simulator/`](../../simulator/)**, which is the current source of truth.
>
> v1 is kept here because it is still runnable for parity comparison and is
> invoked by the dashboard's "Check now" calibration flow
> (`dashboard/check_now.py` spawns `archived/v1/check_testcases.py`).

## Running

All commands run from the **monorepo root** (the scripts resolve their data —
`shared/assets`, `shared/fighters_data`, `testcases/`, `test_results/` — from
their own location, but `check_testcases.py` writes run snapshots and testcase
ids relative to the repo root, so run it from there). The shared Python venv
lives at the repo root.

```bash
uv sync                                   # provision the shared venv (repo root)
uv run python archived/v1/battle_main.py            # run a single configured battle
uv run python archived/v1/check_testcases.py        # re-run the testcase corpus vs game results
uv run python archived/v1/compare_results.py        # compare run snapshots vs baseline
uv run pytest archived/v1/tests/                    # v1 unit tests
```

`check_testcases.py` re-runs the battles in `testcases/` and compares simulator
output against the captured `game_report_result` values, writing a snapshot to
`test_results/runs/` and ingesting into `test_results/dashboard.sqlite`.

## Data locations (post-reorg)

| Data | Location |
| --- | --- |
| Engine (`Base_classes/`) | `archived/v1/Base_classes/` |
| Troop/hero stats & skills | `shared/assets/` |
| Fighter profiles | `shared/fighters_data/` |
| Calibration corpus | `testcases/` (repo root) |
| Run snapshots / baseline / DB | `test_results/` (repo root) |

`Base_classes/JsonUtil.py` resolves `shared/` data from its own file location,
so imports work regardless of the current working directory.

---

## Original usage notes (preserved)

1. Edit `shared/fighters_data/fighters_stats.json` to add your account's bonus
   stats from a battle report.
2. Max hero base stats live in `shared/assets/hero_base_stats.json`;
   fighter-specific hero skill levels live in
   `shared/fighters_data/fighters_heroes.json`.
3. Edit fighter names, troops, heroes, and joiner heroes in `battle_main.py`.
4. Toggle `BattleRound.DEBUG` / `show_rounds_freq` in `battle_main.py` for
   round-by-round detail.
5. Run `battle_main.py`.
6. Print the round report with `f.format_report()`.
7. Save a testcase with `f.save_testcase(testcase_file_path, result)`, supplying
   the actual result from the in-game battle report.

### Stats

Sum the relevant Bonus Overview values (Troops + per-class attack, plus
Natalia's and Jeronimo's special bonuses) for precision. Re-capture stats
whenever buffs/facilities/research/hero upgrades change, and update
`shared/fighters_data`.

### Heroes and joiner heroes

```python
{'Jessie': {'skill_1_level': 1, 'skill_2_level': 0}}   # level 0 skips the skill
['Jessie', 'Jasser', 'molly']                           # levels from fighters_heroes.json (else lvl 5)
```

### Testcases

For chance-skill battles, collect several in-game results into the testcase's
`game_report_result` list and pass `--repeat N` (skipped for `_nc`
"not-chance" files). With `--combine-repeats`, the averaged repeated result is
printed per testcase.
