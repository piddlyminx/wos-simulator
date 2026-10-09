# Three-army peer search

Search heroes, gear and troop ratios against automatically generated player setups, then compare the retained candidates directly. The input's configured defenders are not used as opponents. The original optimizers remain available.

```sh
simulator/node_modules/.bin/tsx scripts/three_army_peer_optimizer.ts \
  scripts/three_army_optimizer.example.json \
  --jobs 20 --output test_results/runs/my_peer_search/winner.json
```

Accepts existing three-army inputs and the loadout optimizer's optional `gear_optimization` block. See [the loadout optimizer documentation](three_army_loadout_optimizer.md) for the gear format and inferred-gear assumptions. The optimized side, capacities, hero pools, uniqueness and skill levels come from the input. It uses sequential battles with shuffled opening slots.

## Method

1. Enumerate the current input's legal hero lineups. Select six with a greedy maximum-minimum distance in hero slot identities, starting with the first legal lineup. No hero names or earlier-run files are prescribed. If fewer than six lineups exist, reuse them with different ratios and gear.
2. Generate varied opponent compositions: one lancer-heavy march and two marksman-heavy marches, rotating their positions and infantry proportions. Rank gear profiles by the sum of their four percentage bonuses for panel construction; put the stronger lancer/marksman profiles on the matching marches, and vary infantry placements. This ranking only constructs opponents; the actual search evaluates every gear permutation.
3. Keep the panel fixed during the search. Each evaluation equally weights all six opponents and both attacker/defender roles. A repetition budget is the **total complete matches** across that panel, rather than a per-opponent multiplier. Budgets must be divisible by twelve. Survivor-margin standard deviation pools sample variances after orienting both roles toward the candidate.
4. Run alternating hero, gear and adaptive troop stages using the existing loadout search. Defaults are two passes with 12 matches per screening candidate, 240 for stage confirmation and 1200 for independent panel validation. The troop search includes zero and single-troop variants and stops at 1% resolution.
5. Retain stage winners, the original setup, up to 24 confirmed alternatives (at most three per exact hero lineup), and up to eight additional screened hero lineups. Every evaluated setup and its score is saved, even if it is not shortlisted.
6. Run a full shortlist round robin with 200 matches per unordered pair, half in each battle role. Then run the top twelve against one another with **2000 fresh matches per pair**. Rank by equally weighted wins plus half draws; use mean signed survivor margin to break exact ties. A singleton field plays no games and reports score 0.5, win rate 0, and margin 0.

Search flags follow `three_army_loadout_optimizer.ts`, including `--passes`, `--starts`, `--screen-reps`, `--reps`, `--validation-reps`, `--finalists`, `--jobs`, and `--seed`. The two tournament budgets and the final twelve are currently fixed. The winner's parent directory must not already exist, even as an empty directory or symbolic link; it is created exclusively before any artifacts are written. The winner filename must not equal an artifact filename. Existing inputs and previous runs are never reused as the artifact directory.

## Evidence and limitations

Artifacts beside the winner include `input.json`, `panel_loadouts.json`, `panel.json`, `methodology.json`, `evaluations.jsonl`, `retained_candidates.json`, `search.json`, `shortlist.json`, `final.json`, and `summary.json`. Pairwise results preserve matchup cycles that aggregate rankings can hide. All scoring uses the simulator; it is not live-game validation.

This is a conditional search, not an exhaustive search of every joint hero/gear/ratio combination. The six generated opponents are a heuristic reference field. Small screening batches can overlook good candidates, and a lineup that excels against that field may fare poorly against the finalists. The final tournament corrects rankings within its retained field, but does not prove a global optimum or universal matchup strength. Increase screening/confirmation budgets or starts to explore more thoroughly. Gear values are taken from the current input; previously discussed corrections are not inferred automatically.
