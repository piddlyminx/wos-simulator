# Corrected FC audit draw scores — 2026-09-07

**The error was in the audit helper, not the production testcase runner.** The original FC worker used `signedRemainingScore`: attacker winners score +A, defender winners −D, and draws zero. Its game references were A−D. Production `executeTestcaseCase`, its adjusted-stat samples, and `extractOutcomeScores` consistently use `battleScoreDelta = A−D` on both sides of the comparison.

The [corrected results](results.json) rerun exactly the five affected Volley candidates with the same frozen config, runtime, inputs and 1,000 original seeds each. [worker.mts](worker.mts) verifies every old winner score before storing the correct margin together with **both survivor totals, per-type survivors, winner, round count and cap status for every sample**. [replay.mts](replay.mts) checks all original artifacts remain unchanged. No production scoring or combat code was altered.

| Case / candidate | Game A−D | Correct mean ± per-battle SD | Raw p | Draws / 1,000 |
| --- | ---: | --- | ---: | ---: |
| S8 11,548 / current | 11267 | 11346.00 ±23.80 | 0.001000 | 1 |
| S8 11,548 / separate skill job | 11267 | 11346.16 ±23.79 | 0.001450 | 1 |
| S8 11,548 / Volley omitted | 11267 | 11267 ±0 | 1.000000 | 1,000 |
| S8 25,000 / Volley omitted | 24929 | 24719 ±0 | 0.000050 | 1,000 |
| S8 33,452 / Volley omitted | 33427 | 33171 ±0 | 0.000050 | 1,000 |

Exactly **3,002 of 5,000 score values** change. All 5,000 original winner-score samples reproduce under the frozen engine and seeds; the change is how draws are represented numerically. Current and separate-job 11,548 runs each contain the same draw at index 267: A11268/D1, round 1500, margin11267. All omission samples reach round1500 with A11268/D1, A24720/D1 or A33172/D1 respectively.

Omitting Volley exactly matches the 11,548 game draw, including its observed round cap and both survivor counts. It does not match the other two game victories. Current and separate-job 11,548 distributions still place the game outcome in a low-probability tail under the fixed-input model. This correction therefore changes the omission evidence substantially, but does not identify a production mechanics fix.

## Scope of the correction

The original [worker](../worker.mts), [replay](../replay.mts), [screen results](../results.json), [confirmation](../confirmation.json), [config](../config-snapshot.json) and round-limit verification files remain **byte-for-byte unchanged**. Their SHA256 values are recorded in `results.json.preservedHashes`. The original descriptive note is retained as [original-README.md](original-README.md); the parent note now points to this correction.

The other zero-valued FC screen sample was [replayed separately](inspection.json): S9 2200 Lancers, index447, had **both sides at zero on round107**. Its winner score and survivor margin are both zero, so CrystalLance/IncandescentField comparisons and the combined six-case inference do not change. No other original FC candidate or confirmation contained a zero winner score. The earlier non-FC troop review had no zero simulator samples. Outer-army-ceil corpus comparisons already delegated to the production A−D runner, and its deterministic checks separately retained both sides. Those results do not require a score correction.

The three recent manual hero batches likewise retain per-side outcomes and have no draw predictions in the reviewed comparisons. Their margins coincide with winner score. The Gatot fractional-state note already identifies the difference between draw score and remaining troop counts and uses the survivor fields directly.

All game records remain accepted unless explicitly excluded. The ambiguous Ambusher trial recording A581/D9 is retained as written and separately flagged for its disagreement with the per-line transcription; both positive totals alone are not authority to relabel it a draw.

## Export metadata recommendation (separate from scoring)

The recommendation below describes the state at this audit snapshot. It was subsequently [implemented and verified separately](../../gatot-export-metadata/README.md): all69 runnable Gatot exports now retain the recorded winner, known rounds and input cap. Original FC audit inputs/results and their hashes remain historical and unchanged.

[inspection.json](inspection.json) records the current corpus scan: **296 accepted entries / 613 stored outcome rows**, with **15 rows having both sides alive**. Fourteen are Gatot observations explicitly recorded as draws in `gatotEvidence.ts`; the fifteenth is the ambiguous Ambusher trial. None of those exported draw observations retains an explicit `winner: "draw"`. The source ledger contains one further historical draw whose input is unavailable and which remains excluded from runnable fixtures. Counts are a timestamped snapshot during ongoing capture work.

`runnableTestcase` currently drops observed `winner` and `rounds`, and drops the explicit input `maxRounds=1500`. Runtime default1500 happens to preserve the present cap, so this omission is metadata loss rather than the audit score error. A bounded future exporter fix should preserve:

- `game_report_result[].winner` and known `rounds` from the observation;
- `maxRounds` from the built input;
- the original survivor counts and all exact troop/stat/hero inputs.

**Do not set input `maxRounds` to an ordinary victory's observed round count.** An observed round923 battle still has the input cap1500. Do not map only recorded game draws to score0; that would break the runner's existing symmetric margin contract and discard surviving-troop evidence. No fixtures were regenerated in this correction.

Two focused contract checks would be useful alongside that separate exporter work: an exported known draw preserves A9720/D1, winner draw, observed rounds1500 and input cap1500; and a known round923 victory preserves cap1500 rather than using923 as the battle limit. A production testcase draw test should assert nonzero A−D survives execution/sample recording on both game and simulator sides. Existing `signedRemainingScore` behavior can remain useful for winner-oriented callers and should not be changed globally to repair an audit.

The scalar margin can still hide compensating per-side differences or a winner mismatch. For mechanic evidence, inspect the retained sides, explicit winner and rounds as well. This corrected audit saves those fields for every sample; it does not claim the general runner already performs a full joint validation of them.
