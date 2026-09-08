# Hendrik initial-phase challenge — 2026-09-07

**The evidence supports changing S3's first activation to turn2 while leaving S2 unchanged.** A shared one-turn offset fits the survivor totals slightly more closely overall, but its additional S2 change only exchanges small residuals between already-close outcomes. It does not have the same independent evidence as the S3-only hypothesis frozen before the third capture. No production change is made by this review.

[definitions.json](definitions.json) froze ten named candidates and all four accepted Hendrik fixture inputs before any candidate simulation. The three new full333 game totals17/471/68 and historical Renee/Hendrik A14 were already known. The new [16/31/21 defender vector](../defender-troops.png) arrived just after the freeze and before simulation; [exposure-before-replay.json](exposure-before-replay.json) records that timing. Every comparison here is retrospective. Original prospective forecasts and engine archives remain unchanged in their parent packages.

All four accepted Hendrik fixtures were replayed with exact recorded kits/stats/troop keys, ceiled surviving source strength and fractional survivor state preserved. Historical Renee444+Hendrik100 remains A14 under every candidate; its S2/S3 are locked, so it supplies no evidence about their timing. In the Lancer-only full333 fixture S3 has no Marksman source and emits no damage jobs. It is useful for checking the S2 change independently of S3 damage.

## Fixed-input results

Numbers are defender survivors. All current and counterfactual outcomes are deterministic; each frozen input was run directly, without coefficient fitting. [results.json](results.json) preserves both sides, winner, rounds, modeled effect use, S3 jobs and relevant skill reports.

| Named candidate | Lancer game17 | First Marksman game471 (313/82/76) | New Marksman game68 (16/31/21) |
| --- | ---: | --- | --- |
| Current: S2 first4/e4, S3 first3/e3 |17 |476 (314/84/78) |78 (19/34/25) |
| Only S2 first3/e4 |18 |475 (313/84/78) |77 (18/34/25) |
| **Only S3 first2/e3** |**17** |**471 (313/82/76)** |**71 (16/32/23)** |
| Shared N−1: S2 first3/e4, S3 first2/e3 |18 |469 (312/82/75) |69 (15/32/22) |
| S2 first1/e4 |20 |473 (312/83/78) |75 (16/34/25) |
| S2 delay1 |17 |476 (314/84/78) |79 (20/34/25) |
| S2 duration1 |5 |480 (317/84/79) |86 (24/35/27) |
| S2 DamageTakenDown grouping |17 |476 (314/84/78) |78 (19/34/25) |
| Opposite S3 offset: first4/e3 |17 |479 (314/85/80) |85 (21/36/28) |
| S3 first2/e3 plus S2 first1/e4 |20 |467 (311/81/75) |66 (13/31/22) |

The shared N−1 candidate gives total residuals+1/−2/+1 and no per-line residual larger than1 in the new capture. That is compatible with reasonable deterministic accuracy, but it is a newly selected retrospective combination. Moving S2 first4→3 alone barely shifts either Marksman outcome; moving it after S3's earlier phase changes only1–2 troops across the three captures. The prior S3-only hypothesis already makes the first Marksman vector exact and reduces the new residual from10 to3, with per-line residuals0/1/2. Its frozen displayed-stat screen gave total70–71. These small remaining differences should be recorded, not removed by choosing an unproven S2 phase.

The one-turn S2 duration alternative materially damages the independent Lancer match17→5 and worsens the new Marksman result. Later S3, delayed S2 and the S2 grouping alternative do not explain the new endpoint. S2 first1, alone or combined with earlier S3, gives less consistent residuals across the captures. Those are meaningful disconfirmations of the named alternatives, not proof that no other mechanism can fit.

## Activation counts and limits

The reports give S2/S3 counts5/6 in the first Marksman battle and8/11 in the new battle. Game round counts are **not known**.

- Current predicts5/6 and8/10, respectively.
- S3 first2 alone predicts5/7 and8/11.
- The shared N−1 candidate also predicts5/7 and8/11.

Thus the new reported S3 count independently agrees with the earlier phase, while the first capture's7-versus6 discrepancy remains unresolved. It must not be erased by reinterpreting activations as observed battle rounds.

In the S3-only model, the first battle ends on simulated round20 and the final S3 job occurs on that same round; its three jobs total about1.986 fractional kills. The new battle ends on simulated round32 and its final S3 activation is also terminal, totaling about1.720 fractional kills. A blanket claim that reports omit terminal activations would remove one count in **both** modeled battles, conflicting with the new reported11. Different actual game finishing phases or reporting rules remain possible, because those round counts are model predictions. The shared S2 shift extends the modeled new battle to round33, making its last S3 activation nonterminal; that is an interesting consequence, not independent evidence for the S2 change.

The new total71 versus68 is modest but exceeds the usual1–2 survivor aim for these small deterministic battles. It remains explicit, as do the per-line residuals and old activation-count disagreement. The earlier471-versus476 difference alone was only about1% of the endpoint; support is stronger now because the prospectively frozen phase alternative improved a second, smaller battle with a larger relative separation. This does not validate higher skill levels, other damage-kind interactions or a global initial-counter rule.

## Minimal implementation recommendation

Add only `"first": 2` to `Hendrik.skills.DragonsHeir.trigger`, retaining `"type": "turn"` and `"every": 3`. The existing trigger mechanism already supports explicit first activation; no runtime counter change, S2 offset, coefficient adjustment, source-count change or casualty rounding is needed. Keep S2 phase and terminal reporting uncertainty in the evidence ledger.

[freeze.mts](freeze.mts) and [replay.mts](replay.mts) preserve the complete [config snapshot](config-snapshot.json) and30 source/definition hashes. They reject an existing frozen output and assert sources stayed unchanged during replay. The four fixture inputs are embedded in the definitions, so later observation-metadata additions do not silently alter this historical comparison. Original accepted evidence remains accepted; historical source/fixture hashes are not rewritten after future production changes.
