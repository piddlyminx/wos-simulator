# Gwen S3 source count at preparation

**Using the previous source attack's troop count improves the first4/every5 candidate in both accepted captures, but does not settle the mechanic.** This is an isolated simulator counterfactual. Production combat code and game observations were not changed.

The hypothesis is narrow: Blastmaster damage uses the number of living Marksmen when the grenade was prepared, one normal attack before delivery. Only the source count changes. Targets, damage modifiers, shields, effect consumption and counters still use the delivery-time model. The existing inner source-count ceiling and adopted fractional outer army term remain intact; the 10% coefficient is untouched.

Both earlier outcomes were known before this diagnostic. The directional prediction, candidate schedules, source hashes and exact inputs were written to [protocol.json](protocol.json) before running them: an earlier, larger source count should increase S3 damage and reduce defending survivors. The third formation was added prospectively using only its supplied input; its capture logs, fixture and outcome were not read.

| Candidate | First defender survivors I/L/M; total | Second defender survivors I/L/M; total | S3 counts, first/second |
| --- | --- | --- | --- |
| Game | 241/581/575; **1397** | 461/58/44; **563** | 4/9 |
| Production first5/every4 | 237/579/572;1388 | 444/53/37;534 | 5/11 |
| First4/every5, delivery count | 241/582/576;1399 | 463/61/48;572 | 4/9 |
| First4/every5, preparation count | 241/581/574;1396 | 461/60/46;567 | 4/9 |
| First5/every5, delivery count | 239/583/577;1399 | 466/63/50;579 | 4/9 |
| First5/every5, preparation count | 238/582/576;1396 | 464/61/48;573 | 4/9 |

The first4/every5 preparation candidate has total residuals−1/+4 and per-line residuals `[0,0,-1]` / `[0,2,2]`. Its second S2 count is8 against game7. The first5/every5 preparation candidate still misses the second endpoint by 10 and also produces8 S2 activations. Thus source-count timing improves a specific schedule without explaining every recorded detail. Raw residuals are retained for scale-appropriate judgment: one/two is Paul's reasonable aim for his usual sub-1,000 armies, with more flexibility on larger armies and no inferred fixed percentage rule.

These fresh results use the adopted arithmetic. The prior frozen diagnostics used the former outer ceiling, explaining small differences such as production second535→534 and first5/every5 second580→579. Original artifacts remain preserved.

## Prospective third-formation forecast

Input only: [gwen-small-timing-550/input.json](../../probes/gwen-small-timing-550/input.json), copied into this package. Full Gwen3/1/1:550 T6 Marksmen versus 810 Infantry/45 Lancers/45 Marksmen, with supplied report-resolved stats. No generation bonus is added.

| Candidate | Predicted outcome | Rounds | S2/S3 counts |
| --- | --- | ---: | --- |
| Production | Attacker 76 | 78 | 13/19 |
| First4/every5, delivery count | Defender 98:91/7/0 | 76 | 12/15 |
| First4/every5, preparation count | Defender 79:74/5/0 | 79 | 13/16 |
| First5/every5, delivery count | Defender 125:116/9/0 | 71 | 12/14 |
| First5/every5, preparation count | Defender 114:106/8/0 | 73 | 12/14 |

These exact-input forecasts were saved at **2026-09-07T05:26:46.193Z**, before any third-outcome exposure to this reviewer. [results.json](results.json) SHA256: `b84a2f1302b3c07c7174699ecc1abd93d1fd319cebb9440fba95b34f506a4559`. They are point predictions; this artifact does not claim an exhaustive stat-precision envelope. The new formation loses its defending Marksmen, so source timing can change battle duration and activation counts through ordinary combat feedback.

## Third outcome, confirmed after forecast freeze

The report at **2026-09-07 06:29:43**, X791/Y577, records **24 defending Infantry surviving, zero Lancers/Marksmen, and zero attackers**. Root visually confirmed the full Gwen3/1/1 kit, exact troop counts and every displayed stat match the frozen input. Observed S2/S3 activations are **15/18**, with displayed kills 7/36. No explicit round total is shown. Defender mail ID: `2734692464123174`.

This rejects all five frozen point predictions for the smaller formation. Source-count preparation alone still predicts79 or114 defenders, and the production model predicts76 attackers. The prospective JSON and its hash above remain unchanged; [confirmed-observation.json](post-capture/confirmed-observation.json) records the later exposure separately.

[The subsequent branch review](post-capture/README.md) found no skipped Gwen jobs from the within-round target-exhaustion guard. It did confirm that the first S3 target consumes the shared EagleVision charge before the backline jobs. A bounded retrospective change to consume EagleVision once per S3 fanout gives an interesting first5/every5 result: both earlier backline vectors match exactly, but Infantry residuals remain−3/−4, and the new battle predicts **18 attackers**, with the observed 15/18 S2/S3 counts. The 42-survivor signed disagreement and opposite winner remain unexplained. Production is unchanged.

## Causal implementation and checks

[replay.mts](replay.mts) creates two private temporary copies of the guarded current engine. The changed copy stores the preceding round-start snapshot in a local variable owned by that run, then supplies its source count only to jobs whose effect is `Blastmaster/1`. It never changes `runtime.troops`, reads a future round, or replaces the target count. The current engine's `snapshotTroops` already copies each side's troop map, so the saved snapshot does not follow later casualty mutations.

The script verifies one uncancelled attacker normal attack per round in all three formations. Thus previous round equals previous source normal attack **in these inputs**. Every S3 damage trace is checked against `sqrt(ceil(previous source count)) × sqrt(minimum initial army)`, retaining the source ceiling's existing residue tolerance. Every other job's army term is checked against its delivery count. The results retain source round, raw and ceiled counts, delivery count, army term and per-target raw kills for every S3 job.

Exact patch anchors, original/changed source hashes, frozen input/config hashes and script hash are recorded. Production source hashes are checked before and after execution; temporary copies are removed. Rerun from the repository root using a new output path:

```sh
npx --yes tsx docs/mechanics-audit/reviews/gwen-preparation-snapshot/replay.mts /absolute/new-result.json
```

This does not test earlier buffs, target locking, whole-damage snapshots, multiple source troop classes, cancelled attacks, or delivery after source exhaustion. It does not infer a reporting rule for activation counts or displayed kills. There is no new coefficient fit, skill configuration edit, or claim that the two retrospective improvements establish preparation timing in game.
