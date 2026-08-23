# Deploy simulator interface plan

## Goal

Add a game-familiar deployment interface as an alternative to `/simulate` and
`/bear`. The existing pages remain unchanged. The new page reuses their live
state, worker, persistence, and result contracts while rendering a separate
game-native army editor, so the interaction model can change without silently
omitting or reinterpreting simulator inputs.

## Existing functionality inventory

### Shared army setup

- Three troop categories with exact counts and a linked fixed-total ratio editor.
- Preset troop tiers plus validated custom troop-type identifiers.
- One category-matched main hero per troop category.
- Hero skill levels S1-S4, including mode/role-aware skill availability.
- Optional automatic A/D/L/H stat adjustment when changing heroes, with an undo
  notification and an option to disable future syncing.
- A 3 troop type x 4 stat base-bonus matrix accepting decimal input.
- Effective-stat previews which combine base stats, main-hero skill 4, the
  army's buffs, pets, and the opposing army's debuffs.
- City buff/debuff presets and individual values.
- Pet buff/debuff preset plus individual values.
- Player stat profiles: load, create, update, delete, and remember the profile
  name in saved-run payloads.
- Battle-report OCR import with side selection, hero selection, skill 4 levels,
  rally interpretation, city buffs/debuffs, pet effects, side swapping, and
  warnings for fields that could not be parsed.
- Keyboard-friendly numeric editing and desktop troop-count tab order.

### PvP-only setup and actions

- Separate attacker and defender armies.
- Swap attacker and defender state while retaining the user's visual placement.
- Rally toggle, revealing up to four joiner heroes on each side and activating
  eligible main-hero skill 4 effects.
- Compact/mobile attacker, defender, and results tabs; simultaneous two-column
  army editing on wide screens.

### PvP execution modes

- Simulate the configured matchup for a configurable replicate count.
- Optimise either side's troop ratio while holding total troops, tiers, heroes,
  stats, buffs, and the opposing setup fixed.
- Adaptive optimisation with coarse/local/final replicate controls.
- Grid optimisation with ratio replicates and grid-step controls.
- Infantry minimum/maximum bounds, ranking choice, estimated composition and
  battle budgets, and validation for invalid/oversized searches.
- Explore both armies' ratio surfaces with points-per-edge, replicate and worker
  controls, progressive previews, progress reporting, and cancellation.
- Browser-worker execution for simulation, optimisation, trace generation, and
  ratio-surface work.

### PvP results and follow-up actions

- Win/loss/draw and survivor summary cards.
- Outcome distribution with a selectable representative seed.
- On-demand representative battle trace with totals, skill kills, per-round
  actions, and state changes.
- Attacker and defender skill-use summaries.
- Optimisation summary, 3D samples, top ratios, row selection, and applying the
  selected ratio back to the chosen army.
- Ratio-surface matrix and linked attacker/defender slices with hover/pin
  selection.
- Mode changes replace stale results rather than mixing incompatible outputs.

### Bear-specific functionality

- One rally army using the same troops, tiers, heroes, skills, joiners, stats,
  profile, OCR, buffs/debuffs, and ratio editor.
- Fixed Bear-target simulation with configurable replicates and progress.
- Score distribution, representative seeded trace, and player skill-use table.
- Adaptive or grid ratio optimisation with infantry bounds, budget validation,
  progress, best-score/mix/count summaries, 3D samples, selectable top ratios,
  and applying the selected ratio to the army.

### Saved runs and navigation

- Automatic persistence after successful PvP, Bear, optimisation, and ratio
  exploration runs.
- Shareable run URLs and hydration of all relevant inputs, options, results,
  traces, and loaded profile names.
- Recent-run browsing with pagination, refresh, timestamps, mode labels, and
  keep/cleanup protection.
- Loading, persistence, worker, validation, trace, OCR, and saved-run errors.
- Public-simulator deployment allowlisting and dashboard/public navigation.

## New information architecture

- `/deploy` is the alternative, with Battle and Bear deployment tabs in one
  game-style shell.
- The Battle and Bear tabs use their production controllers, workers, adapters,
  persistence, and result components, but switch the shared army input to a
  dedicated deploy renderer. The normal `/simulate` and `/bear` renderers remain
  unchanged.
- The familiar visual hierarchy is: deployment-mode strip, report/history
  utilities, large hero slots with a visual picker, three minus/count/plus troop
  rows with linked sliders, an always-visible ratio strip, quick formation
  actions, focused report-style setup sheets, and a persistent deployment
  command bar. Results remain a dedicated workspace tab on smaller screens.
- Stats, skills, rally joiners, city/pet bonuses, and profiles are presented as
  focused in-game sheets rather than dashboard accordions. This carries the
  extra simulator functionality without putting every field on the main march
  screen at once.
- Saved and recent runs remain inside `/deploy` by rewriting only client-side
  navigation destinations; canonical stored share URLs remain unchanged for
  backward compatibility with `/simulate` and `/bear`.

## Responsive contract

- Mobile: one army/result workspace at a time; full-width 44px controls; compact
  sticky deployment command; no horizontal scrolling.
- Tablet: one wide army panel with denser troop/stat grids and persistent mode
  controls.
- Desktop: existing responsive breakpoint behavior, including two PvP armies
  when sufficient width is available.
- Wide desktop: bounded readable content width, paired armies, and expanded
  result visualisations without stretching forms into excessively long rows.

## Verification matrix

- Unit: public-route allowlist and alternate saved-run URL helper behavior.
- Browser smoke: route and Battle/Bear switching, representative input wiring,
  run-mode controls, modal access, saved-run destination rewriting, and no
  viewport overflow at 375, 768, 1280, and 2048 CSS pixels.
- Repository gates: dashboard unit tests, TypeScript, ESLint, production build,
  smoke tests, and `git diff --check`.
