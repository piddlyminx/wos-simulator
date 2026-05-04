# Browser Simulator Feasibility Report

Prepared for WOS-282 on 2026-05-04.

## Scope

Assess the current Python simulator implementation and report whether it can be
rewritten in JavaScript, or otherwise run client side in the browser.

This report covers the battle simulator only. Dashboard ingestion, SQLite
history, OCR/report parsing, emulator control, and `check_testcases.py` remain
server/local workflows.

## Current State

The battle engine is small enough to port or package:

- Core battle classes: `Base_classes/*.py`, about 2,342 lines.
- Testcase runner and metrics: `check_testcases.py`, about 938 lines.
- Dashboard live simulation wrapper: `dashboard/simulate_common.py` and
  `dashboard/simulate_battle.py`, about 375 lines.
- Static data inputs: JSON assets in `assets/`, plus testcase JSON fixtures.

The dashboard currently runs simulations from server-side Next routes:

- `dashboard/web/app/api/simulate/route.ts` spawns
  `dashboard/simulate_battle.py`.
- `dashboard/web/app/api/simulate/optimize-ratio/route.ts` spawns
  `dashboard/optimize_ratio.py`.
- `README_DASHBOARD.md` documents that `/simulate` needs Python available.

The simulator core itself is mostly browser-friendly logic:

- Combat math uses `math`, dictionaries, lists, enums, and JSON.
- Static input data is already JSON.
- The battle loop has no numpy/OpenCV/Pillow/ONNX dependency.
- Stochastic skills use Python's `random.random`.

The broader repo has Python dependencies that are not part of the battle loop:
OCR and report parsing use NumPy, OpenCV, Pillow, RapidOCR, ONNX Runtime, and
Tesseract. Those should not be pulled into a client-side simulator target.

## Mechanical Contract To Preserve

A browser implementation must preserve the calibration contract documented in
the WOS knowledge files:

- The two-pass damage model:
  - normal pass: `base * effective_coef * normal_coef`
  - extra pass: `base * effective_coef * (extra_coef - 1.0) * extra_mult`
- Shared skill handling for hero skills and troop skills; no separate
  hardcoded class-advantage path.
- Targeting distinctions for `benefit_vs`: `all`, `any`, `target`, and a
  specific unit type.
- Skill timing, duration, lag, frequency, dodge, pause, and chance semantics.
- Stochastic repeat behavior and traceability back to skill/effect metadata.
- Dashboard metrics must not hide regressions; browser simulation results need
  to be comparable with `check_testcases.py` output.

## Feasibility Summary

Running the simulator in the browser is feasible.

The lowest-risk path is not an immediate JavaScript rewrite. The best first
milestone is to extract the pure simulator entrypoint and run the existing
Python engine in Pyodide/WebAssembly behind the `/simulate` UI. That proves
browser execution, identifies packaging/performance limits, and keeps the
current mechanics as the source of truth while the dashboard still has a server
fallback.

A TypeScript rewrite is also feasible, but it is higher risk because the current
accuracy work lives in many small Python semantics: enum matching, mutable
Benefit objects, per-round cached chance rolls, attack counters, target
fan-out, Python `ceil`, and stacking behavior. A rewrite should be treated as a
parity project with a golden-test harness, not a direct feature change.

## Option A: Pyodide/WASM Wrapper

Description: ship the existing pure Python battle code and JSON assets to the
browser using Pyodide, then expose a JS facade equivalent to
`dashboard/simulate_battle.py`.

Feasibility: high.

Work required:

- Split browser-safe simulator code from CLI/reporting concerns.
- Remove or guard server-only imports in the browser path, especially
  `tabulate`, file writes, and working-directory assumptions.
- Replace `JsonUtil` filesystem loading with an injected asset bundle.
- Add an explicit seeded RNG hook so Python server and browser runs can be
  compared deterministically.
- Package only `Base_classes`, `assets/hero_skills`, `assets/troop_stats.json`,
  `assets/troop_skills.json`, and `assets/hero_base_stats.json`.
- Run in a Web Worker to keep large repeat counts from blocking the UI.

Advantages:

- Fastest path to true client-side execution.
- Reuses current Python mechanics, reducing accuracy drift risk.
- Keeps a clean fallback to the existing server route.
- Good for a proof of concept and for offline/local privacy-sensitive
  simulation.

Risks:

- Pyodide has a large initial download and startup cost.
- Browser packaging must avoid the OCR stack entirely.
- File-oriented imports and `os.listdir` asset discovery need refactoring.
- Long repeat runs still need worker progress/cancellation.

Recommendation: build this first as an experimental engine behind a feature
flag. Keep server Python as the default until parity and performance are proven.

## Option B: TypeScript Rewrite

Description: port the battle classes and simulator data model to TypeScript and
run the engine directly in browser JavaScript.

Feasibility: medium-high, but higher risk than Pyodide.

Work required:

- Define a schema-first TypeScript model for fighters, skills, effects,
  benefits, unit types, stats, and run summaries.
- Port the core classes in this order:
  1. `UnitType`, `StatsBonus`, and JSON normalization.
  2. `Skill`, `Effect`, `RoundEffect`, and `Benefit`.
  3. `Fighter`.
  4. `BattleRound`.
  5. `Fight`.
  6. Dashboard facade matching `simulate_battle.py`.
- Implement an explicit seeded RNG and pass it through skill/effect proc sites.
- Add golden parity tests that run the same testcase inputs through Python and
  TypeScript, comparing survivor results, rounds, per-skill activations, and
  eventually damage-pass traces.
- Only switch the dashboard default after deterministic and stochastic parity
  thresholds are agreed.

Advantages:

- Small runtime bundle compared with Pyodide after initial port.
- Better integration with React state, Web Workers, and future UI interactions.
- Easier typed contracts with dashboard forms and simulation sharing.

Risks:

- Highest chance of accidental mechanics drift.
- JavaScript floating point is compatible enough for broad math, but parity can
  still diverge through rounding points, object mutation order, string-to-number
  normalization, and RNG behavior.
- The current Python code is the calibrated source of truth, so every rewrite
  result needs evidence before it is trusted.

Recommendation: do this only after the Pyodide proof of concept or in parallel
with a golden-test harness. Do not replace server Python in one step.

## Option C: Keep Server Python, Improve UX

Description: keep the current server-side Python execution, but make it feel
more client-side through streaming, saved runs, caching, and worker-like
controls.

Feasibility: already implemented in part.

Advantages:

- Lowest risk to accuracy.
- No browser packaging complexity.
- Server routes can continue using local files and Python helpers.

Limitations:

- Not client-side execution.
- Requires Python on the host/container.
- Does not solve offline/privacy-sensitive local browser simulation.

Recommendation: keep this as the production fallback during any browser-engine
work.

## Performance Snapshot

Measured on this checkout using the existing venv:

```bash
.venv/bin/python check_testcases.py --glob emulator_verified/simple_001_nc.json --repeat 1 --no-run-snapshot
```

Result: one deterministic testcase completed in about 0.06 seconds.

```bash
.venv/bin/python check_testcases.py --glob 'emulator_verified/*.json' --repeat 1 --skip-invalid --no-run-snapshot
```

Result: 86 emulator-verified testcases completed in about 0.81 seconds, with
about 35 MB max RSS in the local Python process.

These numbers suggest the battle loop is not the main blocker. Browser startup
cost, asset packaging, worker lifecycle, and parity validation are the larger
risks.

## Proposed Delivery Plan

1. Pure-engine extraction:
   - Add a side-effect-light simulator package boundary.
   - Make asset loading injectable.
   - Add an explicit RNG interface.
   - Keep current Python APIs working.

2. Golden parity harness:
   - Select deterministic no-hero controls, deterministic hero cases, and
     stochastic cases.
   - Compare Python server output with browser-engine output.
   - Include survivor results, rounds, and skill activation summaries.

3. Pyodide proof of concept:
   - Load the extracted Python engine and asset bundle in a Web Worker.
   - Add a hidden/feature-flagged browser engine option on `/simulate`.
   - Stream progress and support cancellation.

4. Decision checkpoint:
   - If Pyodide startup/performance is acceptable, harden it.
   - If bundle/startup is unacceptable, use the harness to begin a TypeScript
     rewrite.

5. Optional TypeScript rewrite:
   - Port the engine incrementally behind the same interface.
   - Keep Python as the oracle until parity is demonstrated.

## Acceptance Criteria For A Browser Engine

- Deterministic controls match Python exactly or within an explicitly documented
  one-survivor tolerance.
- Stochastic cases match Python distributions under the same seeded RNG, or
  match agreed aggregate tolerances when RNG engines differ.
- No change hides current dashboard regressions or weakens quality gates.
- Browser runs expose enough metadata to explain mechanics: final survivors,
  rounds, skill activations, and eventually damage-pass traces.
- Server-side Python remains available as a fallback until the browser path is
  proven across the emulator-verified suite.

## Recommendation

Proceed with a two-phase approach:

1. Build a Pyodide/Web Worker proof of concept around the current Python engine.
2. Use the same parity harness to evaluate whether a TypeScript rewrite is worth
   the additional risk and maintenance cost.

This gives the board a real browser-running simulator quickly while protecting
the accuracy work already invested in the Python implementation.
