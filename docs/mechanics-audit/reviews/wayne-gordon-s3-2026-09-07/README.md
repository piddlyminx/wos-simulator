# Wayne and Gordon S3: accepted-evidence review

This retrospective review covers **18 distinct input entries and50 outcome records**, with full recorded kits and exact troop/stat/cap inputs preserved. It contains136,058 validated simulator rows, including13,001 draws. The50 records are not asserted to be50 independent battles. No production definition or observation changed.

The [protocol](protocol.json) fixes omission, source/target, damage-kind and lifetime alternatives. Each stochastic model has1,000 samples; deterministic models run once. [comparisons.tsv](comparisons.tsv) and [summary.json](summary.json) preserve every comparison. Scores are attacker minus defender survivors, with both sides and rounds retained separately. All current stochastic distributions are compatible at the runner's raw diagnostic threshold in this sample; the previously flagged Hector/Renee/Wayne outcome remains a concern rather than being declared resolved by a new seed.

## Wayne S1: ThunderStrike

The clean Infantry-only full Wayne2/2/2 case records attacker251/255/247/256/250. Current predicts253.872 with per-battle SD4.037 and p=.630768. Omitting S1, or restricting its carriers to Marksmen, predicts226.131 with SD4.854, p=.00005. S2 has no Marksman source here. This supports a positive S1 contribution outside Marksmen while retaining the real stochastic S3.

The deterministic750-Marksman Gatot case gives game/current defender2738, versus2752 without S1. Together these contexts support positive Infantry and Marksman carriers. In the Renee/Wayne mixed510-vs888 case, current423.381±1.826 is plausible for game427; omission416.503 and Marksman-only420.412 fail the raw comparison. These do not uniquely establish every4 timing, the full magnitude curve or all lifecycle branches.

Changing S1 generated damage from skill to normal produces exactly identical samples in most inputs and small plausible shifts in the Reina combinations. Therefore this batch **does not discriminate S1 damage kind**. Being implemented as an extra skill job is not itself game evidence of that classification.

The Gordon/Wayne small cases retain current attacker8 versus game5, and defender3 versus game19. Removing S1 gives defender156/106, showing substantial S1 sensitivity without explaining those residuals. Their stale descriptions are retained as a provenance conflict below; no S1 change follows from a closer alternative in another mixed kit.

## Wayne S2: RoundaboutHit

The two mixed Wayne entries have different recorded stat profiles and are compared separately. They record attacker[110,216,308,314] and[394,352,382,284,322,328,364]. Current means are219.663±79.587 and308.903±47.867, with p=.857807/.035098. Whole S2 omission predicts55.912±116.663 and126.827±126.847, p=.00245/.00015.

In the second entry, omitting only the Lancer-target component predicts246.874±76.330 (p=.0007), and omitting only the Marksman-target component274.413±61.414 (p=.0015). Thus both target contributions have contextual support in that exact full-kit/stat profile. In the first entry, each component omission remains plausible individually; it does not independently identify both branches. The Wayne/Reina/Wu Ming set likewise accepts omission.

The named `wayne_s2_solo` input is weak positive evidence despite its title: game359/364, current362.385±3.002 and S2 omission360.279±3.087 are all compatible. Other single-Infantry-target or no-Marksman-source inputs have exactly unchanged results on omission, consistent with unexercised scope.

Starting S2 on attack1 instead of2 remains plausible in every stochastic input. Exact phase, two-attack cadence versus other schedules, damage kind, coefficients, source restriction and effect handling during target depletion are not established by this batch. All recorded skills remain present; no artificial in-game isolated kit was used.

## Wayne S3: Fleet

In the Infantry-only full2/2/2 case, omitting S3 or restricting it to Marksman sources produces the constant226, versus the five game outcomes247–256 and current253.872±4.037. This is strong positive evidence for a chance-bearing contribution outside Marksmen. Mixed Wayne, Renee/Wayne and Wayne/Reina cases also reject omission, though the Gatot capped draw does not discriminate it.

The Marksman-only Wayne case records359/364; current362.385±3.002 is plausible, while omission gives a constant359. That supports variable contribution from Marksmen too, but two observations do not uniquely establish10% chance or a100% multiplier.

The normal-kind alternative remains compatible in every input. It shifts Renee/Wayne from423.381±1.826 to425.817±2.459 for game427, improving a point fit while both distributions remain plausible. No damage-kind change is justified. The exact proc chance, multiplier, probability independence, full level curve and triggering/delivery lifecycle remain open.

## Gordon S3: ToxicRelease

The two full Flint/Gordon/Jasser fixtures give strong contextual evidence for the Infantry vulnerability and a window longer than one turn:

| Model | First gameD1517 | Second gameD1017 |
|---|---:|---:|
| Current |1516|1016|
| Omit Infantry component |1565|1054|
| Both components last1 turn |1537|1032|
| Both components affect all enemy classes |1469|980|

The Marksman component cannot contribute against these Infantry-only opponents. The five-outcome Lynn/Gordon input exercises it, but removing that component remains plausible: game mean5065.4, current5019.535±215.873 p=.260287, Marksman omission5136.663±194.853 p=.19439. Whole omission is rejected (5340.772±132.843, p=.00045), which cannot certify the individually unresolved Marksman branch. A dedicated positive discriminator is still needed for that branch.

The Gatot secondary-kit case retains gameA851 in366 rounds versus currentA834 in376. Infantry-component omission gives699, but current's17-survivor/10-round residual remains unexplained.

**The other Gatot case illustrates why a net score alone is insufficient.** Game is an attacker victory with4573 survivors, no defenders, at1151 rounds. Broadening both Gordon S3 components to all enemy classes gives the superficially close net score4575, but the simulation is a1500-round draw with4996 attackers and421 defenders (411 Infantry/10 Lancers). That is not agreement. Current gives4996 attackers, no defenders, at1037 rounds; deleting S3 or either component leaves that endpoint unchanged. The broad alternative also fails the cleaner Gordon fixtures, so it is not a repair.

## Provenance and reproducibility

Both Gordon/Wayne fixtures carry a description of2000-versus6000 Lancers and an883-survivor report, while their structured entries contain260/255-versus1000 Lancers and gameD19/A5. Git history shows the conflicting text already present at their introduction in `a851fb65`; there is no later file revision identifying which description was copied. Their structured observations remain accepted under Paul's policy, and the discrepancy is preserved rather than silently rewritten or used to discard evidence.

`wayne_mixed_solo.json#1` says it is the same battle as#0 with OCR noise, despite holding different outcome arrays. These may describe the same setup rather than identical observations, but that is not established. The review neither pools their arrays nor assumes independence; every result is conditional on its exact recorded input.

All frozen source hashes remained stable. `summarize.py` verifies each raw sample's per-class sums, A−D score, mean, SD, draw classification and identical current samples across overlapping skill reviews. Generated damage-job traces and modifier traces are recorded separately. Trace execution proves what the simulator did; the actual recorded outcomes and contrasts provide the conditional game support.

```sh
simulator/node_modules/.bin/tsx docs/mechanics-audit/reviews/wayne-gordon-s3-2026-09-07/worker.mts ThunderStrike NEW_SUFFIX 1000
python docs/mechanics-audit/reviews/wayne-gordon-s3-2026-09-07/summarize.py
```

The worker refuses existing output and changed frozen sources. Repeat with the other IDs in the protocol as needed. The summary reads preserved primary results without rerunning combat. This batch reviews the active corpus and does not claim an exhaustive archived-evidence search, all levels, all damage-kind interactions or rally/joiner coverage.
