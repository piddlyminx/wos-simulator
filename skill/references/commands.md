# Commands Reference

## Read This When

Read this before modifying command documentation, `wosctl`, or examples that call command-line tools.

The command reference must match `scripts/wosctl --help`. If a flag or command is not implemented, do not document it.

## Rules

- Check `./scripts/wosctl --help` from the skill root before changing examples.
- Check subcommand help before documenting subcommand flags.
- Do not document removed or broken commands.
- Do not document a `--json` flag unless argparse supports it.
- Keep examples minimal and copy/pasteable.

## Supported Command Surface

Current top-level commands:

```text
status
ensure-ready
goto
report
report-images
reports
memories
screencap
run-battle
run-testcase
create-testcase
shell
capture-hero-skills
capture-hero-skill-details
ensure-alliance
recall-camp
heal
```

`--instance/-i` is required for emulator actions except `status`, offline `report-images`, and the spec-driven `run-battle`, `run-testcase`, and `create-testcase` commands. Spec-driven commands take attacker and defender instance names from the spec.

## Stable Examples

From `skill/`:

```bash
./scripts/wosctl --help
./scripts/wosctl status
./scripts/wosctl --instance <instance-name> ensure-ready
./scripts/wosctl --instance <instance-name> goto world
./scripts/wosctl --instance <instance-name> goto coord 123 456
```

Screenshot capture:

```bash
./scripts/wosctl --instance <instance-name> screencap captures/current.png
./scripts/wosctl --instance <instance-name> screencap captures/full.png --full
```

Full capture rapidly rewinds the current screen to its top, captures overlapping viewports until two no-progress swipes confirm the bottom, and writes one stitched image. The scrolling viewport is detected automatically. For screens with unusual fixed chrome, pass both `--content-top PX` and `--content-bottom PX`; `--max-scrolls N` changes the safety limit for either boundary search (default: 200).

Capture uses calibrated wheel input followed by a short touch drag to restore WOS's scroll bounds, and falls back to touch scrolling when wheel input is unavailable or ignored. Overlap validation runs alongside capture; every join must pass before the output file is replaced.

Hero skill details capture:

```bash
./scripts/wosctl --instance <instance-name> capture-hero-skill-details Gwen --output-dir captures/gwen-skill-details
```

The destination must be new or empty. The skill details pane occupies the bottom third of the hero's Skills screen and updates when an Expedition skill icon is selected. This command navigates to the named hero, confirms the current levels, and selects each Expedition skill icon (three for most heroes, two for heroes with two slots). It saves `hero-skills.png`, each `skill_N.png`, panel crops, and `skill-details.json` with screenshot SHA256 hashes and unreviewed OCR. Visible Upgrade Preview text is included; undetected preview OCR remains unknown until the screenshot is reviewed. No Upgrade button is tapped, and neither the hero roster cache nor battle testcase observations are changed. A failed capture retains partial artifacts with `complete: false` when a manifest has been created. The screen remains on the selected hero's Skills page.

Report capture:

```bash
./scripts/wosctl --instance <instance-name> report --tab war --index 1
./scripts/wosctl --instance <instance-name> report --tab war --index 1 --output captures/my-report.json
./scripts/wosctl report-images captures/saved-report --output captures/saved-report.json
./scripts/wosctl --instance <instance-name> reports --tab reports --count 5
./scripts/wosctl --instance <instance-name> reports --tab starred --count 3 --full-json
./scripts/wosctl --instance <instance-name> reports --tab war --count 15 --long-screenshots
./scripts/wosctl --instance <instance-name> reports --tab war --skip 17 --count 10 --long-screenshots
```

Testcase collection:

```bash
# Deterministic battle: one run
./scripts/wosctl run-battle testcase_spec/example.json
# Stochastic battle: five runs by default
./scripts/wosctl run-battle testcase_spec/example.json --repeat 5
./scripts/wosctl create-testcase testcase_spec/example.json --tab war --index 1
./scripts/wosctl create-testcase testcase_spec/example.json --report captures/my-report.json
./scripts/wosctl create-testcase testcase_spec/example.json --images captures/saved-report
# End-to-end deterministic testcase: one capture
./scripts/wosctl run-testcase testcase_spec/example.json
# End-to-end stochastic testcase: five captures by default
./scripts/wosctl run-testcase testcase_spec/example.json --repeat 5
./scripts/wosctl run-testcase testcase_spec/example.json --dry-run
```

`run-battle` stops after a new report is detected. `create-testcase` can capture any selected existing inbox report, consume previously parsed report JSON, or parse saved screenshots. `run-testcase` is the convenience composition of run, capture, and create.

Only `create-testcase` and `run-testcase` append observations under `game_report_result`. None of these commands runs the TypeScript simulator or writes `sim_result`.

Capture counts and match criteria are defined in [Testcase Evidence Policy](../knowledge/testcase-evidence-policy.md). The examples above show its normal command forms.

Simulator comparison is separate and runs from the repo root:

```bash
npx tsx scripts/run_testcases.ts --matching <pattern>
```

## Removed / Intentionally Undocumented

Do not document:

```text
deploy-army
--json
```

## Documentation Checklist

Before committing command docs:

1. Run the documented command help or inspect argparse.
2. Confirm every flag exists.
3. Confirm every subcommand exists.
4. Confirm output format claims are true.
5. Remove examples for deprecated commands.
