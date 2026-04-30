---
name: wos
description: Automate Whiteout Survival (WOS) on MuMuPlayer Android emulators via ADB. Use when controlling WOS through the local `wosctl` CLI, navigating to known game screens, taking screenshots, reading battle reports from inbox tabs, or promoting repeated in-game actions into deterministic `wosctl` intents.
compatibility: Requires uv, adb, tesseract, and MuMuPlayer. Python deps are auto-installed by uv via inline script metadata.
---

# wos

Control WOS through a deterministic CLI surface. All interaction goes through `wosctl`. Do not run the Python scripts in `scripts/` directly — they are implementation details behind `wosctl`.

## Dependencies

- **uv** — `wosctl` uses inline PEP 723 script metadata (`# /// script`). When `uv` is available, it runs via `uv run --script` and handles all Python dependency installation automatically. No manual `pip install` or venv setup needed.
- **adb** — Android Debug Bridge, for communicating with MuMuPlayer emulators.
- **rapidocr** — OCR engine used by the report reader and hero skill capture.
- **MuMuPlayer** — Windows-side Android emulator, accessed via ADB.

## Environment setup

Before first use, configure these files (all relative to this SKILL.md):

- `config.json` — copy from `config.json.example` and fill in machine-specific paths and per-instance alliance tags (gitignored)
- `data/player_hero_skills.json` — per-instance hero skill levels created automatically by `scripts/wosctl --instance <name> capture-hero-skills`.

This skill lives inside the simulator repository at `skill/`. Agents should still treat this directory as the skill root. The simulator repository root is the parent directory (`..`).

## Execution Policy

- The **only** tool for interacting with WOS is `scripts/wosctl` (relative to this SKILL.md).
- Invoke it directly as an executable: `./scripts/wosctl --instance <name> <intent>`. It is executable and self-bootstraps via `uv run --script`. **Do not run it with `python` or `python3`** — it will fail because dependencies are managed by uv's inline script metadata, not a venv or system packages.
- Do not run ad hoc `adb` commands or `scripts/*.py` helpers directly.
- If an action is not yet exposed through `wosctl`, inform the user and get confirmation before implementing it.
- Prefer stable script-driven flows and template matching over raw coordinate recipes.

`wosctl` resolves dynamic ADB ports by emulator instance name and handles the normal readiness flow internally.

## Supported Intents

- `status` — read-only emulator and WOS state check
- `goto world`
- `goto city`
- `goto coord <X> <Y>`
- `goto pets`
- `goto beast_cage`
- `goto pet "<pet name>"`
- `goto pet_refine "<pet name>"`
- `memories <map>` — clear visible memories labels using a CSV or JSON map
- `screencap <path>`
- `report --tab <war|reports|starred> --index <1-5>` — read and parse a battle report
- `reports --tab <war|reports|starred> --count <N> [--full-json]` — capture and parse `N` consecutive battle reports starting from visible entry 1
- `run-testcase <spec.json> [--repeat N]` — end-to-end battle capture: deploy → fight → capture report → append testcase JSON with hero skill levels and one `game_report_result` observation per successful run. It does not run the simulator and must not write `sim_result`.
- `capture-hero-skills` — navigate to Heroes screen, read skill levels for all heroes, save to `data/player_hero_skills.json`
- `ensure-alliance <tag>` — idempotent alliance switch
- `recall-camp` — recall all encamped troops from the world map
- `heal` — heal all wounded troops (switches to the instance's configured heal alliance, returns after)
- `shell <cmd>` — raw ADB shell (last resort only; prefer all other intents first)

Read [commands.md](references/commands.md) when you need exact command forms, report-tab rules, pet-navigation details, or memories-map rules.

## Testcase Handling

- Use `run-testcase <spec.json>` as an in-game data collection command only.
- Use `--repeat N` to collect a sensible observation count for the same spec, especially for battles with chance effects or other RNG.
- `run-testcase` appends captured game observations under `game_report_result`.
- Testcase JSON files must not include `sim_result`; simulator output belongs in later analysis, not in captured fixture data.
- After collecting enough observations, run the simulator-side testcase checker, such as `../check_testcases.py`, from the simulator repository root to compare against the captured data.

## Report Handling

- `wosctl report` is the supported battle-report reader.
- `wosctl reports` is the supported batch reader for consecutive battle reports.
- It returns the final merged JSON payload, including hero data from Battle Details.
- By default, `wosctl reports` returns a compact payload with `output_dir` and `files`. Use `--full-json` only when the caller explicitly wants all parsed report objects inline.
- If the requested inbox item opens a non-standard report layout, treat that as a missing `wosctl` capability rather than improvising a multi-command workaround.

Read [reports.md](references/reports.md) when you need the output schema, parsing assumptions, or report-specific facts.

## Current Gaps

- Beast search and attack are not yet exposed as `wosctl` intents.
- Troop training is not yet exposed as a `wosctl` intent.
- Chapter-goal interaction is not yet exposed as a `wosctl` intent.
- Pet refine parsing exists, but it is not yet exposed as a `wosctl` intent.
- Some inbox report variants are not yet supported by `wosctl report`.

## Novel/Manual Fallback

- When the requested action is not yet a `wosctl` intent, treat it as novel emulator work.
- In that mode, keep a tight observe-think-act loop and re-check the screen frequently.
- Promote successful repeated workflows back into `wosctl` instead of leaving them as manual recipes.

## References

- [commands.md](references/commands.md): exact `wosctl` commands, tab names, pet navigation details
- [reports.md](references/reports.md): report JSON schema, report parsing facts, OCR assumptions
