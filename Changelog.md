# Whiteout Survival Battle Simulator - Change Log

## 2026-09-26 — Reduce simulator form-change work

- Cache Explore ratios estimates until their grid or replicate settings change,
  rather than rebuilding the pair-count estimate on every form edit.
- Avoid constructing collapsed army-section editors. Memoize troop editors using
  their own category's values and stable callbacks, so an unrelated input change
  does not re-render all six editors.
- Reuse unchanged skill-result tables. Browser verification covered skill edits,
  section switching, hero-stat synchronization, troop Tab navigation, side swaps,
  and a completed 1,000-battle run saved with the edited values.

## 2026-09-26 — Queue dashboard saved-run writes

- Queue saved-run store mutations within the server process, sharing the queue
  across Next route bundles and development reloads. A slow save, index rebuild,
  or cleanup no longer makes other local requests exhaust filesystem lock retries.
- Preserve the cross-process filesystem lock and its existing retry policy.
  No battle mechanics or saved-run format changes.
- Reproduced the previous `ELOCKED` failure with a long-held local lock; the
  regression and all 10 focused lock/store tests pass. Six concurrent saves
  through the running dashboard and shared SSHFS store all returned HTTP 200.

## 2026-09-25 — Match parity cases by participating heroes

- `--matching` now checks hero and joiner names on both sides as well as filenames,
  using case-insensitive substring matching. Directory names and descriptions
  remain excluded.
- Corrected the filename-only regression test; all 32 testcase-tooling tests pass.

## 2026-09-25 — Retire pre-rework Flint parity fixtures

- Preserve the two July 2025 reports in `testcases/heroes_unittests/Flint_tc.json.disabled`,
  with explicit reasons and evidence references. They predate Flint's permanent
  skill kit: the contemporaneous definition (`6b223c2f^:assets/hero_skills/Flint.json`)
  has 20% Pyromaniac burn and 50% Immolation procs, unlike current extracted
  client skills 500214–500216. Their varying outcomes are not deterministic targets.
- No combat mechanics or recorded outcomes changed. Current skill values match
  the extracted client; 32 seeds per historical case produce one current-model
  outcome each. The historical reports remain runnable with `--include-disabled`.
- All four current deterministic lowercase-`flint` cases still pass exact mode
  (solo uses the existing +0.025% stat-rounding adjustment); three existing
  testcase-discovery tests pass. Capitalized `Flint` now selects no enabled cases.

## 2026-09-25 — Existing Dream Marks land through stun

- Deliver pending captured damage before checking the matching normal attack's
  controls. Stun still prevents new mark placement and fresh scheduled strikes.
- The existing mixed Renee/Sonya case matches 744 survivors under either model:
  Sonya stuns Infantry while other allied troop lines can deliver the mark.
- Added two pure-Lancer captures under `testcases/emulator_verified/renee_stun_20260925/`.
  The game returns 61 attackers and 106 defenders, exactly matching independent
  delivery. Blocking delivery predicts 39 attackers and 125 defenders; allowing
  both placement and delivery through stun predicts 99 attackers and 38 defenders.
- The regression failed before the correction and now passes. All 252 tests
  and typechecking pass; exact deterministic passes improve from 283/312 to
  285/312 on the same expanded cohort. Only the two new capture results change.
- Comparison evidence:
  `tmp/renee-stun-evidence-20260925.json`.

## 2026-09-25 — Enemy stuns suppress scheduled extra attacks

- Narrowed the preceding pause change: self-applied pauses permit scheduled
  extra attacks, but enemy-applied controls suppress them. An overlapping
  self-pause cannot override an enemy stun.
- Captured two deterministic Sonya/Hendrik battles: the corrected model
  matches 422 defenders and 12 attackers exactly; the broad pause model
  predicted 443 defenders and 4 attackers at the captured stats.
- Captured five full-kit Wayne/Sonya battles. Defender survivors were
  35, 37, 26, 30, 43. Across 10,000 simulations per model, suppression predicts
  a mean of 31.21 defenders versus 26.15 when scheduled strikes ignore stun.
  All five observed Thunder/Bounty/Torrential counter combinations fit the
  suppressed schedule and contradict the always-allowed schedule.
- Preserved seven unique reports under
  `testcases/emulator_verified/scheduled_skill_stun_20260925/`.
- All 251 simulator tests and typechecking pass. Same-cohort deterministic
  exact passes improve from 281/310 to 283/310; only the two new deterministic
  captures change. The Ahmose/Wayne self-pause matches remain intact.

## 2026-09-25 — Thunder Strike survives Ahmose's pause

- A cancelled normal attack now still delivers active turn-triggered extra
  attacks. Attack-triggered follow-ups and normal cadence counters remain blocked.
- Ahmose/Wayne pure-Infantry captures now match 141 defenders against Jasser and
  50 against Wu Ming at recorded stats, including Viper/Thunder activation counts.
- Deterministic exact Ahmose passes improve from 47/52 to 49/52; the full
  deterministic cohort improves from 277/305 to 279/305, with no lost passes.
  Three Ahmose-matching residuals remain: Gordon/Wu Ming (+49 survivors),
  Gordon/Wayne/Jasser (-7), and Gordon/Gwen/Gatot/Patrick/Hendrik (-1), using
  the runner's existing stat-rounding allowance.
- Added a regression that failed before the fix and passes afterward.
  All 249 simulator tests and TypeScript typechecking pass.

## 2026-09-25 — Recover delayed-hit fast-mode performance

- Skip the pre-declaration pending-hit pass when the effect index has no active captured damage.
- Keep captured damage scalar unless its prepared job shape can receive attack-limited target modifiers or trace output requires retained bucket factors.
- The initial timing change cost 6.4% across six representative fast-mode fixtures. After optimization, a CPU-pinned Node v24.16.0 ABBA comparison measured 0.9% more runtime overall: five fixtures within 1.5%, with the Renee source-death fixture 3.8% slower. This is not a strict per-fixture 1% guarantee.
- Verification: 128,928 timed battles with fixed seeds and warmup; all 36 complete fast/standard/trace result snapshots unchanged by optimization; 248 tests and TypeScript typechecking pass. Benchmark report: `tmp/renee-timing-performance-20260925.json`; frozen replay bundle: `tmp/renee-timing-benchmark-20260925.tar.gz`.

## 2026-09-25 — Delayed hits consume next-hit modifiers on landing

- Captured damage no longer applies or consumes attack-limited target modifiers.
  Delivery combines the currently eligible modifiers with the stored damage
  factors, then consumes them and settles shields. This is generic modifier
  handling, not a Gwen-specific exception; other heroes' interactions remain
  predictions unless independently verified.
- Pending hits land before the following ordinary attack is declared, so they
  cannot consume a new vulnerability created by that subsequent attack.
- Fast, standard, and trace modes agree on all six Renee/Gwen probes and the
  source-death capture. The six Gwen probes now differ from game by 0–3 troops
  at recorded stats. Exact Renee-matching passes improve from 35/45 to 36/45;
  five Renee/Gwen residuals and four unrelated path-matched failures remain.
- Added a mixed Lancer/Marksman regression for capture, delivery ordering, and
  next-hit consumption. All 248 tests and TypeScript typechecking pass.

## 2026-09-25 — Renee Dream Marks

- Dreamslice now amplifies both normal and skill damage against marked targets.
  This fixes five recorded Ahmose/Renee interactions exactly without changing
  the shared damage-taken bucket.
- Nightmare Trace's captured hit can be delivered by another allied troop type
  attacking the marked target after the original Lancers die. The captured
  damage source, target, and calculation remain unchanged.
- Added a prospective source-death capture: the game reports 184 survivors;
  the previous model predicts 27 at the captured stats, and the corrected model
  matches 184. Added regressions for Dreamslice skill damage and source death.
- Original Renee-matching deterministic exact passes improve from 28/43 to
  34/43, with no lost passes. Including two new captures under
  `testcases/emulator_verified/renee_isolation_20260925/`, 35/45 pass.
- Renee/Gwen timing remains unresolved. A new mixed capture reports 187
  defenders versus 105 predicted at recorded stats (157 with the runner's
  allowed stat adjustment). Delivery-time modifier experiments substantially
  reduce the discrepancy but still miss exact endpoints; they are not applied.

## 2026-09-25 — Gordon skill-damage timing

- Restricted Chemical Terror's following-turn bonus to normal damage. Its
  skill-damage bonus now applies on the triggering turn, as does suppression.
  Venom Infusion and Toxic Release are unchanged.
- Added two Gordon/Wayne captures and a Wayne-only control under
  `testcases/emulator_verified/gordon_interactions_20260925/`. The larger
  overlap capture matches 313 defenders at recorded stats. The prospective
  follow-up predicts 206 versus 207 observed, matching exactly within the
  existing 0.005 percentage-point stat-rounding allowance. The Wayne-only
  control matches 21 defenders without adjustment.
- Added an endpoint regression for the skill-damage overlap. On the same
  expanded Gordon-matching cohort, exact passes improve from 16/32 to 21/32,
  with no lost passes. Six actual Gordon cases still fail: four by one
  survivor, plus the Ahmose/Gordon and Ahmose/Gordon/Wayne mixed formations.

## 2026-09-25 — Ahmose Blade of Light

- Blade of Light now deals a separate skill-damage hit instead of adding its
  damage percentage to the normal attack's hero-damage bucket. Prayer of Flame,
  Viper Formation, and Blade's next-turn target debuff are unchanged.
- Added two live isolation captures under
  `testcases/emulator_verified/ahmose_isolation_20260925/` and an endpoint
  regression covering Bradley stacking and Wu Ming's skill-damage reduction.
  Both captures match at recorded stats: 77 and 82 defenders remaining.
- Original Ahmose-matching deterministic exact parity improves from 20/51 to
  39/51; including the new captures, 41/53 pass. Mixed-hero failures remain,
  including an Ahmose/Renee/Gwen case that regresses from 252 to 274 defenders
  remaining against the recorded 252.

## 2026-09-25 — Gordon timing

- Chemical Terror's normal Lancer damage bonus now starts on the following turn;
  its enemy damage reduction remains on the triggering turn. Venom Infusion
  is unchanged.
- Added three Gordon-only captures and a no-hero control under
  `testcases/emulator_verified/gordon_isolation_20260925/`. Two prospective
  timing probes distinguish the delayed bonus from delayed Venom or delayed
  suppression; all four captures pass exact comparison with the existing
  report-stat rounding allowance. Mixed-hero discrepancies remain.
- Added a regression for Chemical Terror's distinct offensive and defensive
  phases.

## Monorepo Reorganization

- **Promoted the TypeScript simulator to the primary source of truth.** `v3/`
  is now `simulator/`; the `@v3/*` alias name is retained but resolves to
  `simulator/src`.
- **Archived the legacy Python simulator** under `archived/v1/` (engine,
  `check_testcases.py`, `battle_main.py`, `compare_results.py`, and tests). It
  remains runnable and still backs the dashboard's "Check now" calibration flow.
  The shared Python toolchain (`pyproject.toml`, `uv.lock`) stays at the repo
  root because the same venv powers the OCR/import helpers and the skill.
- **Separated simulator data by schema.** The v1 and v3 simulators use
  incompatible config schemas, so their data is not shared: the legacy-schema
  game assets moved to `archived/v1/assets/` (with the v1 engine), while v3 keeps
  its own `simulator/config/`. Only `shared/fighters_data/` (plain stat profiles
  read by both the v1 sim and the v3 tournament) lives in `shared/`. `testcases/`
  deliberately stays at the repo root — its path string is a stable logical id
  baked into the calibration DB, waivers, and parity normalization.
- **Three primary components:** `simulator/`, `dashboard/`, `skill/`. The agent
  skill is kept self-contained (all runtime resources live under `skill/`).
- Legacy Python code is now cwd-independent (data resolved from file location;
  `sys.path` bootstraps for `Base_classes`/`check_testcases`). All suites pass:
  simulator (159), dashboard unit + build + specs, Python (28), skill (65).

## ✅ Completed Fixes & Improvements

### Core Mechanics Fixes

- **`benefit_vs` Semantics Cleanup** - Disambiguated the overloaded `benefit_vs: "all"` keyword. Previously `"all"` was doing double duty: in pass 2 (extra attacks) it meant "fan out splash to every surviving enemy type", but in pass 1 (normal attacks) it was quietly being used as "globally active buff" — two different jobs under the same name. Introduced a new `benefit_vs: "any"` value for the "globally active, non-splash" case, reserved `"all"` exclusively for fan-out splash (which requires `extra_attack: true`), and added a load-time check in `Effect.__init__` that rejects `benefit_vs: "all"` without `extra_attack: true` with a helpful message suggesting `any` or `target` instead. Migrated 52 existing hero/troop effects from `all` to `any` accordingly. Fixes a subtle target-freezing bug that surfaced in jessie_solo_nc #8 (both sides running Jessie) where `benefit_vs: "target"` on a permanent skill locked the DamageUp benefit to the round-0 primary target rather than applying globally.
- **OppDamageDown Calculation** - Fixed debuff calculation that was incorrectly multiplying by 0.8 instead of dividing by 1.2 (for 20% debuff)
- **Mean Calculation** - Switched from geometric mean to arithmetic mean, which improved accuracy to <1% error (would need further investigation for perfect accuracy)
- **Empty Troop Types** - Fixed crash when one troop type has zero units
- **OppDefenseDown Formula** - Corrected denominator calculation from `1-x` to `1+x`, resolving division by zero errors

### Hero & Skill System Fixes

- **Multiple Same Joiners** - Fixed issue where duplicate joiners were stored in a dictionary by name, causing only one to be effective
- **Mia Stacking** - Fixed division by zero error and incorrect stacking behavior when joining with multiple Mias
- **Greg Skill Level 5** - Corrected value from 80% to 40% in skill data sheet
- **Alonso Skill 2** - Fixed trigger conditions in sheet (was marksmen-only, should be all troops) and benefit application
- **Duration Type Validation** - Extended condition check from `['turn', 'round']` to `['turn', 'round', 'turns', 'rounds']` to prevent skills from staying active entire fight (was an issue with Greg S1)

### Game Rework - Stun Removal & skills update

Updated codebase and skill sheets to reflect removal of stun mechanics and the new skill update:
- Alonso Skill 1
- Jeronimo Skill 3
- Natalia Skill 1
- Molly Skill 1
- Philly Skill 3
- Flint Skill 1
- Logan Skill 1
- Hector Skill 2

### Code Quality Improvements

- Fixed reference vs copy issues
- Added division by zero protection
- Fixed mutable default arguments
- Improved `__repr__` implementations
- Added input validation
- Added class constants for magic numbers
- Optimized repeated dictionary lookups
- Cached redundant list comprehensions
- Fixed typos in error messages
- Added docstrings 

**See [CODE_REVIEW_ISSUES.md](CODE_REVIEW_ISSUES.md) for detailed code quality improvements**

---

## 🔧 Known Issues & Future Work

### Pending Fixes

- **Skill Refresh Mechanism** - Greg Skill 1 (and possibly others): skill activation can refresh duration but the effect doesn't stack additively

### General work

- **More testing** - Keep testing different skills/scenarios/etc... to find errors or improvements.

- **Adding new heroes** - Currently : up to gen 5

---

## 🚀 Future Enhancements

### Statistical Analysis & Visualization
- Generate plots showing troop losses/injuries over time
- Being able to run 100+ battles for statistical analysis (average, standard deviation,...)
- Can then be used to compare simulation results with in-game reports to calculate event probabilities and help with testing to improve simulation accuracy

### Other Ideas
- Explore machine learning approaches (GANs, gradient descent) for optimizing stats/ratios with fixed hero compositions
- Implement widget & pet system:
  - Set widget/pet levels
  - Calculate effective stats with widgets, pets, and buffs active

---

*Last Updated: January 2026*
