# Three-army loadout optimizer

This is a separate optimizer. `three_army_optimizer.ts` and its commands remain unchanged.
It reuses that script's input parsing and battle evaluator, but implements a new search.

```sh
npx tsx scripts/three_army_loadout_optimizer.ts scripts/three_army_optimizer.example.json \
  --passes 2 --starts 3 --reps 1000 --jobs 8 \
  --output /tmp/example.loadout.json
```

Run from the repository root. `--help` lists all settings. The output/input identity check runs before parsing or searching and rejects the same file through relative paths, symbolic links, or hard links.
`--json` writes machine-readable results to stdout and progress to stderr. `--output`
writes a reusable, ordinary three-army configuration containing the winning heroes,
troops, effective stats, named gear inventory, and assignments. Both optimizers can
read this configuration; the original optimizer ignores the extra gear section.

## Existing inputs

The existing `attacker`, `defender`, `optimization`, troop IDs, hero pools, skill
levels, unique-hero constraint, passives, stat-provenance flags, and ordering are
supported. The optimized side comes from `optimization.side`, then
`troop_optimization.side`, otherwise attacker. Without hero pools, heroes stay fixed.
Exactly one troop ID of each type is required per optimized army; use a zero count
for absent types. Mixed tiers of the same type are rejected rather than guessed.
Each march retains its own original capacity and troop tiers.

The old `troop_optimization` section remains accepted but its search parameters
are not used: the new search uses the CLI settings described below.

Without a `gear_optimization` section, each army's stats minus its main heroes'
generation bonuses become three transferable profiles: infantry, lancer, marksman.
These profiles include account bonuses and equipped gear; shared Troops' bonuses
must already be included in the input stats. The initial allocation reproduces the
input exactly. Generation stats follow selected heroes and are applied once.

This inference assumes the account baseline is the same across all three armies
for a given troop type. Army-specific buffs embedded in the stats would also move
with the profile. Fighter/player passives remain attached to their original armies.
Gear skill effects are not inferred from four numeric stat values.

## Explicit gear inventory

Optionally add a top-level `gear_optimization` object:

```json
{
  "gear_optimization": {
    "side": "attacker",
    "base_stats": {
      "infantry": { "attack": 1000, "defense": 1000, "lethality": 1000, "health": 1000 },
      "lancer": { "attack": 1000, "defense": 1000, "lethality": 1000, "health": 1000 },
      "marksman": { "attack": 1000, "defense": 1000, "lethality": 1000, "health": 1000 }
    },
    "sets": {
      "infantry": [
        { "name": "I best", "stats": { "attack": 200, "defense": 200, "lethality": 200, "health": 200 } },
        { "name": "I second", "stats": { "attack": 100, "defense": 200, "lethality": 178.55, "health": 198.5 } },
        { "name": "I third", "stats": { "attack": 70, "defense": 70, "lethality": 50, "health": 50 } }
      ],
      "lancer": [
        { "name": "L best", "stats": { "attack": 200, "defense": 200, "lethality": 200, "health": 200 } },
        { "name": "L second", "stats": { "attack": 100, "defense": 100, "lethality": 100, "health": 100 } },
        { "name": "L third", "stats": { "attack": 0, "defense": 0, "lethality": 0, "health": 0 } }
      ],
      "marksman": [
        { "name": "M best", "stats": { "attack": 200, "defense": 200, "lethality": 200, "health": 200 } },
        { "name": "M second", "stats": { "attack": 200, "defense": 150, "lethality": 200, "health": 198.5 } },
        { "name": "M third", "stats": { "attack": 0, "defense": 0, "lethality": 0, "health": 0 } }
      ]
    },
    "initial_assignment": {
      "infantry": ["I best", "I second", "I third"],
      "lancer": ["L best", "L second", "L third"],
      "marksman": ["M best", "M second", "M third"]
    }
  }
}
```

Those numbers illustrate the schema, not Paul's account. Assignment arrays are in
army order. Each type has exactly three complete sets, each used once. Sets move
only between heroes of the same troop type; individual gear pieces aren't searched.
Stats are percentage-point bonuses, added arithmetically:

`effective stats = base_stats + allocated set.stats + selected hero generation`

`base_stats` includes account and shared Troops' bonuses, excludes generation and
the set contributions. It can instead contain account + a reference gear set,
with other sets represented as negative deficits relative to that reference. In
that representation the reference set has four zero contributions.

The inventory and initial assignments must reproduce the input's residual stats
within 0.011 percentage points. A mismatch is an error, not an implicit stat change.
Inferred exports use zero base and full residual profiles; this is mathematically
equivalent for allocations and makes no claim to isolate actual gear contributions.

## Search and workload

Each start runs `--passes` complete cycles. Odd passes run heroes → gear → troops;
even passes run gear → heroes → troops. Default is two passes from the supplied
setup. `--starts 2` adds a lancer-heavy start and `--starts 3` adds a marksman-heavy
start. These are fixed, varied compositions; each keeps the supplied heroes/gear.

Hero stages screen **every legal combination in the configured pools** with current
gear/troops. Gear stages screen all 216 assignments with current heroes/troops.
There are no ratio-based placement restrictions: simulation scores every assignment.
The incumbent and the best `--finalists` quick scores are evaluated again with more
matches; the winner becomes the next stage's incumbent. Candidate seeds are shared
within each comparison and worker count doesn't alter the result.

The new troop search considers each march in turn:

1. Screen a simplex grid at `--coarse-step` percentage spacing (default 10).
2. Retain the best `--seeds` neighborhoods plus the incumbent (default 5).
3. Search within the coarse radius at `--refine-step` spacing (default 2).
4. Search around the best refined candidates at **1%** spacing.
5. Confirm the incumbent and top finalists using `--reps` matches each.

Every zero-type grid point also tries one troop of that type, taking one troop from
each possible donor in turn. Pure marches additionally try one of both absent types
together. This preserves capacity. No percentage grid finer than 1% is searched;
these single-troop variants are the explicit exception. Integer rounding uses the
largest remainders so troop totals remain exact.

All evaluations score the complete three-army match. Objective is wins + half draws,
with average surviving-troop margin as a tiebreaker. At the end, all distinct starts
and stage winners compete again on an independent seed with `--validation-reps`.
This includes the original input, so a noisy search need not force a worse result.
Output reports the validation result, stage history, exact evaluated-match total,
and approximate sampling uncertainty (not a guarantee of the best possible setup).

`--reps N` means **N complete matches per finalist evaluation** for either sequential
or random ordering. Screening defaults to ceil(N/10), final validation to 2N.
Starts, passes, candidates, and refinement neighborhoods multiply total work; reps
is not a whole-run budget. Startup prints all resolved budgets and hero counts, and
each stage prints its candidate count. `--max-candidates` rejects oversized hero
pools; it never silently truncates them.

This is repeated conditional optimization, not a global search. Screening can miss
noisy or narrow optima, and simultaneous multi-category improvements can be missed.
Multiple starts and order changes reduce that risk without eliminating it. Final
validation is independent of search samples, but selecting among its candidates
still introduces some winner-selection bias.

## Checks

```sh
simulator/node_modules/.bin/tsx --test scripts/three_army_loadout_optimizer.test.ts
```
