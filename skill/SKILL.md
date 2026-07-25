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
- `report --tab <war|reports|starred> --index <1-5> [--output <path>]` — read and parse an existing battle report, optionally saving reusable parsed JSON
- `report-images <directory> [--output <path>]` — parse saved overview, troop/stat, and complete Battle Details screenshots without emulator access
- `reports --tab <war|reports|starred> --count <N> [--full-json]` — capture and parse `N` consecutive battle reports starting from visible entry 1
- `run-battle <spec.json> [--repeat N]` — deploy and fight, then stop after detecting the new inbox report; it does not parse the report or write testcase JSON
- `create-testcase <spec.json> [--report <parsed.json> | --images <directory> | --tab <tab> --index <1-5>]` — validate saved JSON, parse saved screenshots, or capture a selected inbox report, then append one `game_report_result` observation
- `run-testcase <spec.json> [--repeat N]` — end-to-end battle capture: deploy → fight → capture report → append testcase JSON with hero skill levels and one `game_report_result` observation per successful run. It does not run the simulator and must not write `sim_result`.
- `capture-hero-skills` — navigate to Heroes screen, read skill levels for all heroes, save to `data/player_hero_skills.json`
- `ensure-alliance <tag>` — idempotent alliance switch
- `recall-camp` — recall all encamped troops from the world map
- `heal` — heal all wounded troops (switches to the instance's configured heal alliance, returns after)
- `shell <cmd>` — raw ADB shell (last resort only; prefer all other intents first)

Read [commands.md](references/commands.md) when you need exact command forms, report-tab rules, pet-navigation details, or memories-map rules.

## Testcase Handling

- Use `run-battle`, `report`, and `create-testcase` when battle execution, capture, and testcase creation need to happen independently.
- `create-testcase <spec.json> --report <parsed.json>` does not run a battle or reopen the inbox. If a reported hero has no saved skill data, existing hero-skill enrichment may still capture those levels from the spec's emulator instance.
- `create-testcase <spec.json> --images <directory>` is also offline: it parses saved screenshots and then applies the same testcase validation. Generic image filenames are classified by content; standard capture filenames are accepted directly. Put explicit non-empty skill levels under each spec hero when the screenshots came from an account without saved `player_hero_skills.json` data.
- Omitting both `--report` and `--images` makes `create-testcase` capture the selected existing report from the attacker instance named in the spec. It does not run a battle first.
- Use `run-testcase <spec.json>` as the convenience composition for end-to-end in-game data collection.
- Use `--repeat N` to collect a sensible observation count for the same spec, especially for battles with chance effects or other RNG.
- `create-testcase` and `run-testcase` append captured game observations under `game_report_result`.
- Testcase JSON files must not include `sim_result`; simulator output belongs in later analysis, not in captured fixture data.
- After collecting enough observations, run the TypeScript simulator testcase runner from the monorepo root with `npx tsx scripts/run_testcases.ts --matching <pattern>` to compare against the captured data.

## Report Handling

- `wosctl report` is the supported battle-report reader.
- Use `wosctl report ... --output <path>` when the parsed report will be materialized later with `create-testcase --report <path>`.
- Use `wosctl report-images <directory> --output <path>` to inspect or save OCR from images before testcase creation. PNG, JPG, JPEG, and WEBP are supported.
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
