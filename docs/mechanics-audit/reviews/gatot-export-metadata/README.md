# Gatot evidence export metadata — 2026-09-07

The exporter now preserves the observed winner and known round count alongside both survivor totals, plus the simulator input's `maxRounds`. This implements the metadata recommendation from the [FC draw-scoring review](../fc-troops/draw-correction/README.md). It changes neither combat behavior nor the production runner's attacker-minus-defender scoring contract.

The normal export command regenerated only `testcases/gatot_verified`. Its existing sync test requires those generated files to match the evidence ledger:

- All69 runnable files gain the recorded winner and explicit input cap1500;14 record draws.
- The56 observations with known rounds preserve that value. The remaining13 retain no invented round count.
- All five disabled files remain byte-for-byte unchanged.
- Removing only the added `maxRounds`, outcome `winner` and outcome `rounds` restores every original parsed fixture exactly. Every prior troop/stat/hero value, survivor observation and other field is unchanged.

The [exact pre-export file contents](before-fixtures.json) and [verification report](verification.json) preserve the before/after SHA256 hashes and metadata additions for each changed file. Before/after checking of70 runtime/config files found only `tooling/exportGatotTestcases.ts` changed; the69 other hashes, including all combat definitions and scoring sources, were unchanged. The exporter test file separately gains two contract checks. Old frozen audit results, configs and source hashes were not rewritten; strict historical replay guards may consequently reject the new exporter/fixture hashes and should not be bypassed silently.

The new tests explicitly verify:

- S8 10,000 Marksmen draw: A9720/D1, observed round1500, input cap1500, and survivor margin9719 even with `winner: "draw"` retained.
- S4 10,000 Infantry victory: A9992/D0, observed round923, input cap1500. The observed finishing round is not substituted for the allowed round limit.

Both tests failed on the previous exporter because it dropped winner/rounds. After the change and regeneration, **40 focused tests pass**, including existing Gatot ledger/export synchronization and testcase contracts. Typecheck and `git diff --check` pass. [Focused output](focused-tests.log) and [typecheck output](typecheck.log) are preserved.

Commands from the repository root:

```sh
simulator/node_modules/.bin/tsx simulator/src/tooling/exportGatotTestcases.ts
cd simulator
node_modules/.bin/tsx --test src/tooling/exportGatotTestcases.test.ts src/tooling/gatotEvidence.test.ts src/tooling/testcases.test.ts
npm run typecheck
```

This is preservation of existing evidence metadata. It creates no new observations, fixes no parity residual, promotes no mechanic review and performs no live-account action.
