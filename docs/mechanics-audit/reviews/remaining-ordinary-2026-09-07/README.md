# Lynn, Norah, Molly S3 and Natalia S1/S2

This retrospective review adds contextual evidence for nine ordinary skills. It does not change production. All24 accepted input entries and63 recorded outcomes were known before the bounded structural alternatives were frozen. The package preserves268,000 simulator rows, complete recorded kits, exact report stats and troop keys. Current models are stochastic in all24 entries; none of these runs is a new game battle.

Individual game outcomes are compared with per-battle simulator distributions using the existing combined CDF/support diagnostic. A raw p below1/250 flags a discrepancy for investigation. Plausibility does not identify a mechanic uniquely; statistical sensitivity and practical survivor differences are considered separately. Repeated cases shared by skills are counted once in the24-entry total. Results are conditional on the other full-kit mechanics, including existing unresolved interactions.

## Lynn

**Song of Lion contributes outside Marksmen.** The five-outcome solo leaves167/200/191/199/149 defenders. Current prediction is185.632 with per-battle SD20.046; omission leaves99. The stronger scope discriminator is the Gordon/Lynn Lancer-only defender: recorded attacker survivors5274/4736/5021/5290/5006 fit current5040.138, SD219.080, p0.376931. Omission and Marksman-only both produce5605 and fail. Moving the effect from the configured lethality bucket to hero damage remains plausible in all six entries; this batch does not identify that bucket.

**Melancholic Ballad contributes against damage sources beyond enemy Infantry.** In the same solo, current185.632 defenders fits, while omission62.499, SD49.045 and enemy-Infantry-only103.374, SD28.658 fail. Both alternatives fail all six entries. Restricting the effect to normal damage produces identical samples throughout, leaving skill-damage protection unexercised.

**Oonai Cadenza still lacks a decisive positive-contribution discriminator.** All six entries accept omission at the chosen screen threshold. In the solo, omission has signed A−D mean42.590 with SD245.523 and p0.013549: the broad distribution can still produce the observed defender wins. The maximum-stack alternative and expansion to all own troops fail that solo, but rejecting those alternatives does not establish current stacking when omission remains plausible. A future probe should separate contribution from omission with substantially less variance.

## Norah

**Combined Arms supports both components and the configured Infantry/Marksman recipient scope in a discriminating context.** `norah_s2_inf_only_A` records643/643/646/645 attacker survivors. Current643.944, SD2.848 fits. Omitting everything674.323, offense657.365, protection661.012, restricting recipients to Infantry657.390, or expanding them to every own class629.684 all fail. In the Lancer-only splash-D case, omission changes nothing whereas expansion to Lancers fails, providing negative recipient-scope evidence. Exact coefficients, kinds, levels and overlapping buckets are not all identified by these contrasts.

**Sneak Strike needs its extra damage and multiple enemy targets.** Seven solo outcomes2703–2833 fit current2740.246, SD53.097, p0.879856. Omission2898 and primary-target-only2880.242, SD5.969 fail, as does allowing every own troop class to trigger it,2489.321, SD95.275. The five-outcome Norah/Greg set also rejects those alternatives. Changing generated damage to normal kind gives identical samples in all13 entries, so damage classification remains unresolved here.

**Momentum supports both components, next-turn onset and two turns rather than one in the Infantry-only attacker case.** Against the same643/643/646/645 observations, omission669.172, omission of offense658.090 or protection656.867, immediate onset651.031 and one-turn duration656.800 all fail. Current643.944 fits. Expanding the offensive target to every enemy class changes nothing in this one-enemy-class case; the other two mixed single observations accept all tested variants. Target locking therefore remains open. Paul's current normal-attack counter model is recorded separately in [the method note](../../physical-interpretation.md); it is not a new timing capture in this batch.

## Molly S3

**Youthful Rage has limited positive contextual support.** Five solo outcomes245/245/244/245/245 fit current243.907, SD1.175, p0.077146. Omission241.172 and Marksman-only242.559 fail the statistical screen, but these are small survivor differences and do not justify a broad materiality claim. The older `Molly_tc.json#3` outcome1070 fits current1070.990, SD2.300, while omission1077.160 is flagged; Marksman-only1074.020 remains plausible. The other two entries accept omission. The hero-damage bucket alternative is indistinguishable or plausible throughout. Broader scope and bucket identification require stronger contrasts.

## Natalia and the remaining mixed-kit disagreement

The single solo observation is2664 attacker survivors; current2617.141, SD20.342 is plausible at p0.032898 but lies well into its upper tail. S1 omission2706 and Infantry-only2647.094 fail, as do S2 omission2752.379 and Infantry-only2741.862. This gives conditional support for both skills and broader recipients, with only one game outcome. Normal-only S1 and the alternative S2 damage bucket do not discriminate in this solo.

The closer S1 Infantry-only mean is misleading: its sampled outcomes cluster around2636/2637 and2670/2671, leaving no samples2658–2668, while current samples include2664. A line-death boundary can create separated outcome groups; a mean between them need not be a plausible game result. Raw per-battle distributions, not distance to the mean alone, determine the diagnostic.

The accepted six-hero mixed entry `3-testcases_mixed-heroes-not-verified.json#2` remains a disagreement: game2823 defenders versus current2907.495, SD26.089, p0.0012. Removing S1 yields2827.680, p0.823359; removing S2 yields2808.573, p0.651817; restricting S2 to Infantry yields2823.654, p0.998500. Those improvements conflict with the solo contrasts and cannot attribute the mixed-kit defect to Natalia. Both skills remain unresolved in the ledger, with their positive solo evidence retained. The filename is not grounds for discarding the recorded outcome.

## Artifacts and limits

[protocol.json](protocol.json) freezes alternatives, hashes, source files and sampling; [cases.json](cases.json) preserves inputs; [summary.json](summary.json) gives unique case counts and result hashes; [comparisons.tsv](comparisons.tsv) gives every candidate's numerical diagnostics. Each named `*-initial.json` and `*-initial-samples.json` pair preserves results and individual simulations. `summarize.py` verifies hashes and equality of shared current samples. No full coefficient curve, rally/joiner behavior or unexercised lifecycle is certified by a contextual fit.
