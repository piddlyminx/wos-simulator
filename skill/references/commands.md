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
