# Three-army Swiss optimizer

Optimizes three-army player setups against other candidate setups from the beginning. It follows the broad-field, ranked-pairing and progressive-elimination idea of the existing dual-Swiss tournament, adapted to complete three-army matches and balanced battle roles. It does not use a fixed opponent panel. The original optimizers are unchanged.

```sh
simulator/node_modules/.bin/tsx scripts/three_army_swiss_optimizer.ts \
  scripts/three_army_optimizer.example.json --jobs 20 \
  --benchmark test_results/runs/earlier_run/winner.json \
  --output test_results/runs/new_swiss_search/winner.json
```

`--benchmark` is optional and repeatable. It adds compatible earlier setups to each stage's field, finalist checks and independent final round robin. Benchmarks do not prescribe opponents for other candidates. The program checks optimized side, gear values, account base stats, capacities, troop tiers, march passives, hero availability and skill levels. With hero pools, each march must contain one hero of each troop type from its permitted pools, at the current input's optimization skill levels, respecting uniqueness. Without hero optimization, each march must retain the current input's fixed heroes and their skill levels. Equivalent hero aliases and array/dictionary representations are accepted. The current input remains authoritative for simulated gear and troop IDs; incompatible benchmarks fail instead of silently changing their setup.

## Search

The JSON format is the existing three-army input format, with optional gear features documented in [the loadout optimizer](three_army_loadout_optimizer.md). Hero generation is removed and reapplied once when changing heroes; gear follows its troop type. Input-derived gear assumptions remain the same as the loadout optimizer.

Each pass conditionally searches heroes, gear and troops. Pass one uses heroes → gear → troops; pass two uses gear → heroes → troops.

- Hero stages include all legal input hero combinations at the current gear and ratios.
- Gear stages include all 216 gear placements at the current heroes and ratios.
- Troop stages search each march with a coarse grid, neighborhoods at finer intervals, then 1% neighborhoods. Zero and single-troop variants are included. Every candidate is evaluated as a complete three-army setup.

Each of those candidate fields runs its own tournament:

1. Fourteen screening rounds by default. The first three use seeded shuffled pairings. Later rounds pair nearby ranks, favoring opponents not yet faced and repairing repeated pairings where feasible.
2. Pairing budgets increase from 2 to 4 to 8 complete matches. Each budget is split equally between attacking and defending. No eliminations occur before six rounds have completed. Afterward, the bottom quarter is frozen each round until at least 64 remain. Uneven fields rotate a bye without awarding invented wins or games.
3. The top 64 surviving candidates, the incumbent and optional benchmarks receive eight confirmation rounds at larger budgets: 16 matches per pair in the first four rounds and 32 in the next four.
4. The top eight, incumbent and benchmarks play a direct round robin with 64 fresh matches per pair. Its winner becomes the next stage's incumbent. Strong confirmation contenders and finalist-check contenders are retained for the final field.
5. The union of retained full setups receives a new fourteen-round qualifier. The top twelve survivors, original setup and benchmarks then play an independent round robin with 1000 matches per pair by default. All final candidates face the same opponents with the same number of matches.

Scores count draws as half a win. Mean signed survivor margin breaks equal score rates. Sorting is deterministic for a seed; worker count does not affect results. Swiss screening scores reflect different opponents and are not universal fitness measurements. Final scores are specific to the final field.

## CLI and artifacts

`--jobs`, `--passes`, `--rounds`, `--screen-reps`, `--qualifier-reps`, `--final-reps`, `--coarse-step`, `--refine-step`, `--seeds`, `--seed`, `--max-candidates`, `--benchmark`, and `--output` are supported. Match budgets must be even. Logs state the active field size, pair count and resolved match budget for every round. `--final-reps N` is N complete matches per unordered finalist pair, half in each battle role; it is not N per role or per starting-order permutation.

The winner's parent directory must not already exist, even as an empty directory or symbolic link; it is created exclusively before any artifacts are written. The winner filename must not equal an artifact filename, including `stage_N.json`. `input.json` and `methodology.json` preserve inputs and resolved settings; `candidates.jsonl` records every distinct full setup; `pairs.jsonl` records every actual comparison with stage, seed and results. Each `stage_N.json` saves screening, confirmation and finalist checks. `history.json`, `final_qualifier.json`, `final.json`, `summary.json`, and the exported winner preserve the result. Inputs, benchmarks and earlier runs are not overwritten.

This remains a conditional search. It does not exhaust every joint hero × gear × troop combination and cannot guarantee a global optimum. Swiss elimination can miss contenders; larger budgets and more passes reduce uncertainty. No rule about which named heroes belong in lancer-heavy or marksman-heavy marches is imposed: the broad field competes to establish that through simulated results. The simulator's limitations also apply.
