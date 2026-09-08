# Independent review of the first Gwen capture

The first observed result was supplied before this review:1397 defender survivors, split241/581/575; S2 activations3/displayed kills3; S3 activations4/displayed kills17. These first-fixture comparisons are retrospective. The second-fixture outcome was not read; its forecasts below use the first captured stats and the prescribed800 Marksmen versus1200 Infantry+100 Lancers+100 Marksmen.

**The first result does not establish a trigger-phase-only correction.** Changing S3 to `first6/every4` and retaining `first5/every4` with delivery delayed one attack produce identical endpoints, line survivors and damage-job schedules in both formations. Their shared delivery behavior can be tested without uniquely identifying a trigger representation.

The phase6 model exactly matches the first survivor split, but records five S3 activations against four observed. Its fifth proc occurs in terminal round22 and deals2.89066 raw kills across three targets. A reporting rule that omits an activation must be demonstrated; endpoint agreement does not explain this discrepancy.

| Bounded candidate | First survivors | First S3 activations | Second forecast |
|---|---:|---:|---:|
| Current |1388|5|535|
| S3 first6/every4 |1397|5|555|
| S3 first5/every5 |1398|4|580|
| Current S3 trigger; delivery delayed1 attack |1397|5|555|
| S1 persistent |1365|5|455|
| S1 one charge per turn or immediate normal-attack charge |1375|5|505|
| S2 first6/every6 |1392|5|543|
| S2 followup mark immediate |1388|5|534|

The simple S1 replacements do not explain the first mismatch. Moving S2's first activation to6 reproduces Infantry241 but leaves backlines579/572, so S2 phase alone also fails. The `every5` S3 candidate predicts238/583/577: its total is close, but its line split differs from241/581/575.

Only normal attacks advance hero cadence in the current runtime (`simulator/src/simulator.ts`, `advanceNormalAttackCounters`). Generated jobs nevertheless consume attack-duration effects (`simulator/src/extraAttacks.ts`, `chargeUsedEffectsForJob`). On round5, AirDominance consumes the available EagleVision15% charge before Blastmaster fanout. Changing S3 scheduling therefore also changes S1/S2 charge consumption; it is not simply adding or removing an independent10% damage job. Single-Marksman formations do not establish shared versus per-troop-type counters in game.

Historical helpers preserve useful alternative models. Replaying `skill/tmp/gwen_one_attack_per_turn_check.ts` gives persistent324 versus one-charge319 for the accepted Renee/Gwen500-vs900 fixture's318 observation. Its earlier620-vs920 example gives458 versus454 for its recorded453. These favor limited-use S1 over a simple persistent replacement in those formations, but do not identify a unique lifecycle for S3-bearing formations. `skill/tmp/gwen_candidate_fixture_check.ts` varies Renee/Gwen grouping, magnitude and scope together; candidate labels are not game observations. Existing `testcases/emulator_verified` fixtures are accepted game evidence without requiring their raw images.

Config history is context, not game proof: `c1357572` (2026-08-14) replaced Blastmaster `every4` plus `turns.delay1` with `first5/every4` during a broad lifecycle rewrite, without adding an S3 fixture. AirDominance `first5/every6` originated in `2f278c43` (2026-07-05), initially as a turn trigger. `05125337` (2026-08-23) changed EagleVision from persistent to attack-triggered with one-attack delay/duration.

At the35% reporting scale, summing `floor(S3 raw kills per target ×.35)` gives18/current,17/phase6,16/every5; flooring the aggregate gives19,18,16. Thus displayed17 can fit phase6 under a plausible rounding rule, but this does not verify the rule or resolve five-versus-four activations. Nor should activations simply be assumed to require positive displayed kills: the final S2 proc has2.42633 raw kills, below one after scaling and flooring, while the observed S2 count is three.

Artifacts: `tmp/mechanics-audit-2026-09-07/gwen-causal-review/review.mts`, `review.json`, `summary.json`, `historical-s1-replay.txt`, and the longer `README.md`. Nine candidate outputs were validated; phase-versus-delivery job schedules are exactly equal for both inputs. No second outcome, production edits or live emulator interaction were used.

## Second capture and bounded follow-up

The first-stage review above is preserved with its original exposure boundary. The parent subsequently supplied the second observation:563 defender survivors, split461/58/44; S1 activations1/no attributed kills; S2 activations7/displayed kills7; S3 activations9/displayed kills39. Displayed stats match the first capture. This contradicts every frozen second forecast in the table; the exact first-fixture match from `first6/every4` does not generalize.

Retrospectively setting S3 to `first4/every5` gives1399 (241/582/576) in the first battle and572 (463/61/48) in the second. It matches S3 counts4/9 but still disagrees materially with the second endpoint and predicts8 S2 activations. Combining that S3 schedule with the previously considered persistent S1 or one-charge-per-turn S1 gives1373/505 or1383/540. The corresponding `first5/every5` combinations give1377/516 or1386/550. These bounded combinations do not resolve the disagreement. Observed S1 activation1 also does not by itself establish persistent damage behavior: simulator registration/activation instrumentation may differ from the report's treatment of passive skills.

At35% reporting scale, the second S3 raw damage gives floor-of-total/floor-per-target values44/43 for current,42/41 for phase6,35/34 for first5/every5 and37/35 for first4/every5. None reproduces displayed39 while explaining the first report with a common demonstrated rule. These attribution totals should not be used to fit a new magnitude.

Follow-up artifacts are `tmp/mechanics-audit-2026-09-07/gwen-causal-review/combined-timing.mts`, `combined-timing.json`, and `combined-summary.json`. They explicitly disclose both outcomes before the six-candidate comparison. The script also explores an uncaptured four-round onset discriminator: a sufficiently large defender makes S3 first4 produce one proc while first5 produces none, before S2 starts. The best scanned800-Marksman example requires16600 defenders of each type and predicts a nine-survivor gap; stock availability was not checked and terminal-activation reporting remains uncertain. This is a design possibility, not a requested or approved capture plan. No production changes or live emulator interaction were used.
