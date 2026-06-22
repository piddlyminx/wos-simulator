# Bear Sim Design

## Goal

Add a new Bear Sim page for estimating bear-event score from one player army.
The user enters or imports one army. The opponent is a fixed bear army, and the
result is the sum of uncapped damage dealt by the user army to the bear over
exactly 10 rally rounds.

## Core Simulation

The simulator package should expose a dedicated bear-battle function instead of
forcing this through the normal survivor-score path. The normal battle loop caps
damage by remaining troop count and commits losses after each round; bear score
needs the opposite behavior for the bear side.

The bear simulation should:

- Resolve the user army as the attacker and the bear as the defender.
- Always use `engagement_type: "rally"` so rally-gated hero and widget effects
  activate.
- Use exactly 10 rounds.
- Reuse existing fighter resolution, skill triggering, target selection, damage
  math, and attack job ordering where practical.
- Sum the raw damage/kills calculated for attacker-to-bear attacks before any
  cap to defender remaining troops.
- Keep bear troop counts unchanged across rounds.
- Avoid committing bear losses. User-side losses are irrelevant because the bear
  has no attack, but the implementation should still avoid depending on bear
  damage behavior.

The first implementation can be a sibling to the normal run loop, sharing helper
functions where the current module boundaries allow it. If extracting a small
internal helper from `runLoop` makes this cleaner, keep that extraction local to
`simulator/src/simulator.ts` and covered by tests.

## Bear Defaults

The bear is represented as:

- Troops: 5,000 infantry.
- Troop base stats: attack `0`, lethality `0`, health `10`, defense `100`.
- Stat bonuses: all `0`.
- Heroes and joiners: none.
- Loss behavior: no losses; damage can exceed remaining troop count.

Defense is intentionally a placeholder. It should be a constant that can be
changed later when calibration data is available.

## Browser Payload

Add a bear request/result type in the dashboard web layer. The request contains
one `SimulateSidePayload` for the user army plus replicates if the UI keeps the
existing multi-run behavior. The result should focus on score:

- Replicates run.
- Mean score.
- Standard deviation.
- Best and worst score.
- Optional per-seed score samples for charts or examples.
- Skill activation and skill-damage summary for the user army.

Normal saved simulate runs do not need to support Bear Sim in the first pass
unless it falls out cheaply. The page can compute locally through the existing
worker path.

## Bear Page UI

Add a new `/bear` page and a nav link beside `/simulate`.

The page should reuse existing simulator UI concepts:

- One editable army panel for the user army.
- Hero selectors, troop tiers/counts, rally joiners, stat inputs, active buff
  controls, and stat preset support from the standard simulator.
- Rally mode is fixed on. The user should not need to toggle it.
- The run panel should say Bear Sim and show score-centric results, not survivor
  margins.

If the existing simulator page components are too coupled to attacker/defender
state, extract narrow shared helpers/components rather than copying the whole
`SimulateClient` file. Prefer small, low-risk extraction: stat preset helpers,
side state conversion, and a reusable army panel.

## OCR Import

The OCR endpoint already returns attacker and defender columns from a stat
bonuses image. Bear Sim should import exactly one of those parsed columns into
the user army.

The upload flow should provide a left/right selector for the parsed image side.
In terms of existing OCR data, left/right maps to the two returned sides before
semantic attacker/defender swapping. The selected side is merged into the user
army using the same stat unbuffing behavior as the simulator page, including
skill 4 and active modifier removal.

## Tests

Add simulator-core tests first:

- Bear battle runs exactly 10 rounds.
- Bear score sums attacker-to-bear uncapped damage rather than capped remaining
  troops.
- Bear defaults are applied as fixed defender stats with rally engagement.

Add dashboard tests after the core behavior exists:

- Bear payload converts one user army into the expected simulator input.
- Worker handles bear simulation requests.
- `/bear` renders, exposes stat presets, and can start a bear run.

Run at least the relevant TypeScript tests and dashboard typecheck before
calling the work complete.

## Out of Scope

- Calibrating the bear defense value.
- Full saved-run/share-link support for Bear Sim.
- Ratio optimisation for Bear Sim.
- Reworking the standard simulator page beyond the extraction needed for reuse.
