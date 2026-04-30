# TODO — Findings from adversarial Codex review (2026-04-28)

Source: `/codex:rescue` adversarial review of the WOS skill repo. Each item lists severity, location, the problem, and the agreed resolution direction.

## High

### 1. Remove broken `deploy-army` command
- **Location:** `scripts/wosctl:748-766`
- **Problem:** `cmd_deploy_army` calls `dispatch.deploy_army(..., tile_tap_x=..., tile_tap_y=..., mode=...)` but `dispatch.deploy_army` (at `scripts/dispatch.py:507`) is defined as `deploy_army(emulator, army_spec)`. The command always raises `TypeError: unexpected keyword args`.
- **Fix:** Remove the `deploy-army` command from `wosctl` entirely. Drop any references in docs/specs.

### 2. Bottom-of-report detection: add retry + hard-fail with diagnostics
- **Location:** `scripts/capture_report_top_bottom.py:246-252,284-296` and `scripts/report_reader.py:244-250`
- **Problem:** `scroll_to_bottom` returns `True` when image mean stops changing — even if `contains_report_end` never matched. `capture_report` records `report_bottom_reached`, but `_parse_captured_report` ignores it and parses anyway, silently producing zero/default stats from a non-bottom frame.
- **Fix:**
  - Implement retry logic to re-attempt reaching the bottom (max 3 attempts).
  - If still not at the bottom after 3 tries: **fail hard**.
  - On hard fail: save diagnostic screenshots and emit an error that clearly states the diagnostic data location so investigation is trivial.

### 3. Unify report parsing + add tier and Fire Crystal level capture
- **Location:** `scripts/parse_report.py:347-348,378-385,489-508,552-578,600-608`
- **Problems:**
  - `_match_template` returns the best location even on an unrelated image; the parser then crops everything (names, stats, troop power, bonuses) relative to that false anchor. Output is corrupt JSON instead of a clean failure.
  - `_best_match` returns `("unknown", -1.0, "none")` with no minimum score; counts go into `new_tp[side]["unknown"]`, which is later dropped from output. Missing troop types silently become zero while parse "succeeds".
- **Fix:**
  - Enforce a minimum score on Battle Overview / Stat Bonuses anchors; include the score in error messages.
  - Enforce a minimum avatar score on `_best_match`; validate per-side parsed sums against report totals.
  - **Bigger refactor:** stat/troop parsing is currently duplicated across (at least) 3 scripts. The simpler OCR scripts in the `wos-simulator` repo do a better job for stats — unify on those. **Retain** this script's troop-type-via-template-matching logic and fold it into the unified parser.
  - **New capability to add to the unified parser:**
    - Troop tier identification (template matching).
    - Fire Crystal level capture (template matching — needs new templates).

## Medium

### 4. Battle-mechanics formula doc/code drift
- **Location:** `knowledge/battle-mechanics.md:50-60,80-84` vs `wos-simulator BattleRound.py:313-315,393-396`
- **Problem:** Docs present `final_coef = base * (extra + normal_only - 1)`, but the code is a two-pass model: pass 2 is `effective * (extra_coef - 1.0) * extra_mult`. Later sections of the doc reference `extra_mult`, contradicting the headline formula.
- **Fix:** Rewrite the formula in the doc as the actual two-pass model so the contract matches the implementation.

### 5. `wosctl --json` flag: make JSON the default
- **Location:** `references/commands.md:16-18` vs `scripts/wosctl:867-878`
- **Problem:** Docs advertise `wosctl --instance <name> --json status`, but no `--json` argument exists.
- **Fix:** Don't implement `--json` — `wosctl` is intended for machine use and should **return JSON by default**. Remove the `--json` example from the docs and ensure the default output across all `wosctl` commands is JSON.

### 6. KNOWLEDGE_INDEX is not an issue tracker
- **Location:** `KNOWLEDGE_INDEX.md:43` vs `knowledge/known-issues.md:14-18`
- **Problem:** Index lists Wayne mixed troops and Reina borderline as active; `known-issues.md` marks both resolved. `KNOWLEDGE_INDEX.md` is misused as an issue tracker.
- **Fix:** `KNOWLEDGE_INDEX.md` is a guide for steering agents to correct methods, **not** an active/resolved issue list. Remove the active-issues section from `KNOWLEDGE_INDEX.md`. Active and resolved issues belong on the agents' kanban board.

### 7. Log debug-copy failures in `report_reader`
- **Location:** `scripts/report_reader.py:227-237`
- **Problem:** `_copy_capture_debug_files` catches every exception and passes silently. When debug capture is requested, missing artifacts become invisible — exactly when diagnostics matter most.
- **Fix:** Log source key/path and the exception at warning level inside the except block.

## Low

### 8. Doc says non-battle reports parse as zeros — they don't
- **Location:** `references/reports.md:41` vs `scripts/report_reader.py:151-156,200-215`
- **Problem:** Docs claim non-battle reports parse as all zeros. Reality: single-report path raises when Battle Overview is missing; batch mode skips until it finds a battle report.
- **Fix:** Update the doc to describe the actual fail/skip behavior.

### 9. Spec-design self-contradiction on hardcoded instance names
- **Location:** `knowledge/spec-design.md:72-79`
- **Problem:** Line 73 forbids hardcoding instance names in knowledge docs; line 79 hardcodes them ("WIP attacks, minxxx defends.").
- **Fix:** Replace with phrasing like "default current setup" or move concrete instance names into config-derived examples.

---

**Out of scope for this list (already addressed elsewhere or deferred):**
- Critical findings on `run_testcase.py` (path traversal + Python code injection via `test_id`) — track separately.
- Hero-skill chance-skill dedup mismatch in `BattleRound.py` (extra-attack buckets) — battle_sim repo concern.
- ADB failure handling in `emulator.py` — covered by other tracking.
- `parse_refine.py` lazy-loading nit and refine schema doc/code mismatch — minor doc fix.
