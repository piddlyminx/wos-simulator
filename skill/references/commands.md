# Commands Reference

## Read this when

Read this before modifying command documentation, `wosctl`, or examples that call command-line tools.

The command reference must match the actual argparse implementation. If a flag or command is not implemented, do not document it.

## Rules

- Check `scripts/wosctl --help` from the skill root before changing examples.
- Do not document removed or broken commands.
- Do not document a `--json` flag unless argparse actually supports it.
- `wosctl` is intended for machine-oriented use; commands that report status should return structured output by default rather than requiring a fake `--json` example.
- Keep examples minimal and copy/pasteable.

## Removed / intentionally undocumented

Do not document:

```text
deploy-army
--json
```

`deploy-army` is not a valid documented command contract and should be removed from code if it is still present. `--json` is not an advertised flag; remove examples that use it.

## Stable examples

Use the tool help as source of truth:

```bash
./scripts/wosctl --help
./scripts/wosctl --instance <instance-name> status
```

For report workflows, prefer documented capture/parse commands only after confirming their names in `--help`:

```bash
./scripts/wosctl --help
```

For testcase capture, use `run-testcase` to collect game observations only. It does not run the simulator or write `sim_result`.

```bash
./scripts/wosctl run-testcase testcase_spec/example.json
./scripts/wosctl run-testcase testcase_spec/example.json --repeat 10
```

If a command is intended for automation, its output should be structured and documented in the command implementation or companion parser docs.

## Documentation checklist

Before committing command docs:

1. Run the documented command or inspect argparse.
2. Confirm every flag exists.
3. Confirm every subcommand exists.
4. Confirm output format claims are true.
5. Remove examples for deprecated commands.
