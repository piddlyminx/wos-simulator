# Third Gwen outcome and bounded branch diagnosis

**Neither source-count preparation nor one EagleVision use per S3 fanout explains all three accepted battles.** The third outcome is defender 24 Infantry, no backline survivors, against zero attackers. Exact inputs were visually confirmed by root; this review adds no game battle or observation. All analysis here follows exposure to all three results.

The earlier [prospective results](../results.json) remain byte-for-byte unchanged: SHA256 `b84a2f1302b3c07c7174699ecc1abd93d1fd319cebb9440fba95b34f506a4559`. [confirmed-observation.json](confirmed-observation.json) records the third result separately, with the timestamp, mail ID, exact-input confirmation and observed 15/18 S2/S3 activations. Reported kills 7/36 are retained without fitting a coefficient or reporting rule.

## Which branches actually execute?

[branch-traces.json](branch-traces.json) instruments the five frozen candidates across all three formations and verifies that every endpoint equals its original forecast. It records within-round target-exhaustion skips, caps after earlier same-round damage, S1/S2 charge ownership, round-start troop counts and attacker jobs.

- **No Gwen job is skipped by `targetExhausted` in any of these 15 replays.** Some defender normal attacks are skipped only after the attacker has already been exhausted in the terminal round. This branch is therefore not an immediate explanation for the wrong Gwen endpoint in these candidates. Already-dead target lines are still omitted from future fanouts by the separate living-target selector.
- **EagleVision is used only against Infantry.** In first4/every5, S3 consumes its charge 4/8/13 times in the three delivery-count battles, always on the Infantry job. None of the S3 Lancer/Marksman jobs gets that charge. AirDominance consumes it first on overlapping S2/S3 rounds, so a later S3 may have no charge available at all.
- The first two battles preserve all defender troop types. The third introduces a new feedback path: killing a backline removes its damage in following rounds. Production kills defending Marksmen in round 41 and Lancers in 61, then wins with 76 attackers. First4/every5 kills Marksmen in 54 but leaves7 Lancers; using preparation counts still leaves5. The game kills both backlines while24 Infantry survive.
- Per-job caps occur when damage finishes a line. The third production S3 Marksman job at 41 has raw damage 3.4833 but only 1.8093 remaining Marksmen; its Lancer job at 61 has raw 1.9602 versus 1.0456 remaining. These are distinct from a whole job skipped by the within-round exhaustion guard. No overflow transfer is inferred.

All of these are verified **simulator** events. The game report supplies final line survivors and skill totals, not per-round attack order or damage allocation.

## One shared S1 use for an S3 fanout

This hypothesis was selected after confirming charge ownership in the traces. [group-consumption.mts](group-consumption.mts) changes only EagleVision use inside a Blastmaster fanout: an already eligible S1 effect stays live across sibling target jobs, then consumes one use at the end. Its value, scope and attack delay are unchanged. AirDominance and normal attacks still consume S1 normally, and every other effect is charged normally. No persistent S1 buff or coefficient adjustment is introduced.

The two compared source-count choices and schedules are exactly the previously frozen ones. [group-consumption.json](group-consumption.json) records15 retrospective results and their original individual-job-use comparisons.

| S3 schedule / source count, grouped S1 use | First defender I/L/M | Second defender I/L/M | Third outcome | Third S2/S3 counts |
| --- | --- | --- | --- | --- |
| Game | **241/581/575** | **461/58/44** | **Defender 24:24/0/0** | **15/18** |
| Production first5/every4 / delivery | 237/578/570 | 433/47/30 | Attacker 110 | 12/18 |
| First4/every5 / delivery | 241/579/572 | 449/55/40 | Attacker 58 | 13/16 |
| First4/every5 / preparation | 240/578/571 | 446/54/38 | Attacker 63 | 13/16 |
| First5/every5 / delivery | 238/581/575 | 457/58/44 | Attacker 18 | 15/18 |
| First5/every5 / preparation | 238/580/573 | 455/57/42 | Attacker 31 | 14/17 |

First5/every5 with delivery counts is the most informative result: both earlier backline vectors match exactly, while Infantry takes 3/4 extra casualties. In the third battle it has the observed 15/18 activation counts at 91 simulated rounds, but predicts the opposite winner with a signed survivor error of42. It is a useful unresolved candidate, not a corrected mechanic.

The earlier Infantry change is an ordinary feedback consequence: extra backline damage reduces later incoming damage, leaving more attacking Marksmen to damage Infantry. It must not be interpreted as a change to S3's Infantry coefficient; the patch changes neither that coefficient nor the first target's direct S1 eligibility.

## What the counts constrain

If the report counts map directly to the existing S2 first5/every6 cadence,15 S2 activations imply 89–94 source normal attacks. Under S3 first4/every5,18 activations imply 89–93; under first5/every5 they imply 90–94. These windows overlap. Under production S3 first5/every4,18 activations imply 73–76, which does not overlap that S2 window.

These are conditional cadence calculations, **not measured game rounds**. They require the reporting and activation assumptions; omitted terminal activations or another counter definition would need separate evidence. Matching counts does not establish the damage mechanism, as the grouped first5/every5 result demonstrates.

The next useful distinction is how S1/S2 damage modifiers apply within an S3 attack event and how backline attrition changes the subsequent trajectory. A blanket persistent S1 alternative and arbitrary magnitude fitting are not supported by this review. The within-round target-exhaustion skip can be deprioritized for these exact inputs because it never removes a Gwen job. Broader targeting and source-exhaustion semantics remain outside this bounded check.

## S2 followup-mark eligibility and comparison

[s2-mark-eligibility.json](s2-mark-eligibility.json) traces the three captures plus every other accepted S2-bearing Gwen fixture identified in the inventory. The earlier deterministic fixtures are `gwen_solo_nc.json#0`, `logan_gwen_combo_nc.json#0` and `renee_gwen_bucket_retry_nc.json#0`, all under `testcases/emulator_verified/`. The Renee fixture preserves Renee3/3/3 and **Gwen2/1/0**. `gwen_norah_combo_nc.json#0` is stochastic; its trace is retained to identify eligible jobs, without treating one simulator endpoint as a distribution comparison.

S1 and the S2 mark never overlap on a damage job in any of these seven baseline traces. A simple change from additive to nonstacking S1/S2 modifiers would therefore have no effect on them. In the three new captures, the current S2 mark always affects the next-round normal hit on Infantry. But on overlapping S2/S3 rounds, the next actual hit after S2 is the same-round S3 Infantry job. Those overlaps occur once, twice and three times respectively. In older mixed formations, the next hit can instead be another troop type's normal attack in the same round. The single-Lancer Renee/Gwen fixture has no such same-round followup.

Those actual eligibility differences motivated four fixed interpretations, all using the previously diagnosed first5/every5 S3 with grouped S1 consumption and delivery source counts:

- Current top-level mark: activate next round, then consume one attack use.
- Previously considered immediate top-level mark: activate before the triggering normal damage. This is a diagnostic timing alternative; it does not represent a mark created after the S2 hit.
- A mark created by the completed S2 extra hit, consumed on the next normal or skill damage job received by that target, with no turn expiration before that next use.
- The same post-S2 mark restricted to the next normal damage job.

[s2-mark-comparison.json](s2-mark-comparison.json) preserves all24 deterministic comparisons, full inputs, configs, mark-bearing jobs and original source hashes. Magnitudes, max stacking, target scope and complete kits are retained. Each changed mark is still5% at the tested level.

| Mark interpretation | First defender total | Second defender total | Third outcome | Older Gwen solo / Logan-Gwen / Renee-Gwen |
| --- | ---: | ---: | --- | --- |
| Game | 1397 | 563 | Defender24 | Attacker3006, five times / Defender403 / Attacker318 |
| Current delayed | 1394 | 559 | Attacker18 | Attacker3011 / Defender403 / Attacker318 |
| Immediate top-level | 1394 | 559 | Attacker19 | Attacker3005 / Defender403 / Attacker318 |
| Post-S2, next damage | 1395 | 560 | Attacker17 | Attacker3005 / Defender403 / Attacker318 |
| Post-S2, next normal | 1394 | 559 | Attacker18 | Attacker3005 / Defender403 / Attacker318 |

The post-S2 next-damage candidate does move the mark onto S3 on overlapping rounds, and leaves both earlier backline vectors exact. Its remaining Infantry residuals are−2/−3, but the third battle still has the opposite winner and a41-survivor signed error. The older Gwen solo endpoint improves, while the other deterministic fixtures remain exactly matched; those endpoints do not distinguish the three changed interpretations from one another. No tested mark lifecycle resolves the third battle, so these results do not justify a production change or further coefficient fitting. No stochastic comparison was added because this bounded causal candidate already fails the decisive deterministic battle.

## Reproduction and limits

Run from the repository root with new output paths:

```sh
npx --yes tsx docs/mechanics-audit/reviews/gwen-preparation-snapshot/post-capture/trace-branches.mts /absolute/new-branches.json
npx --yes tsx docs/mechanics-audit/reviews/gwen-preparation-snapshot/post-capture/group-consumption.mts /absolute/new-groups.json
npx --yes tsx docs/mechanics-audit/reviews/gwen-preparation-snapshot/post-capture/s2-mark-eligibility.mts /absolute/new-eligibility.json
npx --yes tsx docs/mechanics-audit/reviews/gwen-preparation-snapshot/post-capture/s2-mark-comparison.mts /absolute/new-mark-comparison.json
```

Both scripts verify the frozen forecast hash and current source hashes, create isolated temporary runtime copies, preserve exact inputs and complete kits, record exact patches and changed-source hashes, and remove the copies afterward. The charge patch preserves scratch-array identity, so damage calculations continue using the same runtime arrays. It rejects an unspecified S1 child-effect lifecycle; the current S1 has no children. The branch trace is diagnostic-only and checks all 15 endpoints against the frozen originals. The grouped comparison verifies that S1 actually reaches backline sibling jobs.

No production source, skill definition, existing observation or prospective artifact was changed. Absolute residuals remain visible for scale-appropriate judgment; one/two survivors is the usual aim for Paul's sub-1,000 armies, while larger armies permit more flexibility. The third battle's opposite winner and42-survivor error in the closest grouped model remain a substantive disagreement at this scale.
