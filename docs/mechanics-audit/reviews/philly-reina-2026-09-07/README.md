# Philly and Reina: four-skill review

This retrospective review covers22 distinct input entries and62 recorded outcomes. The164,010 simulator rows preserve full kits, exact troop/stat inputs and every observation. It adds no battle evidence and changes no production behavior. Philly S2 and Reina S3 retain their previously reviewed magnitudes and Paul's explicit skill-damage confirmation.

The [protocol](protocol.json) fixes component omissions, source restrictions, damage-kind eligibility and one grouping alternative. Each stochastic model uses1,000 samples; deterministic models run once. [summary.json](summary.json), [comparisons.tsv](comparisons.tsv) and the raw sample files retain all results. Current stochastic comparisons are plausible at the runner's raw threshold in this batch, which does not establish every individual skill or equal game/simulator distributions.

## Philly S1: VigorTactics

Both Attack and Defense components contribute in accepted full-kit inputs. The two Philly solo entries record attacker2254/2252 and3606/3637/3616. Current predicts2252.722±83.805 and3622.461±13.022, where ± denotes simulator per-battle SD. Attack-component omission gives2510.660 and3647.844; Defense-component omission2440.847 and3641.910. Those alternatives fail the recorded distributions, while current is plausible (p=.613769/.726664).

Restricting both components to Lancers also fails these two entries and the stronger repeated Philly/Bahiti entry. The five-outcome Infantry-only Philly and Sergey/Philly inputs further exercise non-Lancer recipients, though their one-to-few survivor shifts are small and should not alone determine materiality. One earlier Philly/Bahiti outcome accepts every tested omission; its mere agreement is not independent component proof.

This supports both components and recipients outside Lancers at the recorded levels1/2. It does not uniquely identify their Attack/Defense grouping against equivalent factors, every troop class, full value curve, stacking with other effects, role gates or lifecycle.

## Philly S3: NumbingSpores

All four exercised input sets use level1. The two solo entries above predict2448.068±70.811 and3639.270±9.785 with S3 omitted, versus current2252.722±83.805 and3622.461±13.022. Omission fails both comparisons. The four-outcome Philly/Bahiti entry also rejects omission; its single-outcome sibling does not.

Restricting protection to own Infantry remains plausible in every set. It is sample-identical to current in both Philly/Bahiti entries; the solo alternatives2329.175±92.447 and3624.470±12.993 remain compatible. Positive backline protection is therefore unresolved. Restricting incoming damage to normal is sample-identical throughout, leaving skill-damage protection untested. The contribution is supported in context, but exact40% chance, shared-round versus other proc timing, magnitude, grouping, backline scope and higher levels remain open.

## Reina S1: AssassinsInstinct

The two S2/S3-locked deterministic entries in `heroes_unittests/Reina_tc.json` give game/current defender62 and40. Omitting S1 flips both winners to attacker392/596; restricting S1 to Lancers gives attacker137/406. These are strong positive S1 and non-Lancer-scope discriminators, preserving the complete recorded kits.

The six-outcome S3-locked entry records attacker1536/1325/1500/1333/1297/1579. Current1403.836±119.608 is plausible (p=.897255); omission1763.761±86.811 and Lancer-only1633.625±92.780 fail. Several other individual mixed cases accept omission and provide much weaker support. The new five-outcome S3 probe also accepts S1 omission, so its support for the S3 magnitude is not reused as positive S1 evidence.

Allowing S1 to affect skill as well as normal jobs remains plausible everywhere. Changing only its damage grouping to `active.hero.damage.up`, while retaining normal-only eligibility, also remains plausible. Many relevant samples are exactly unchanged under those alternatives. This batch supports offensive contribution outside Lancers but does not independently identify the normal-only restriction or exact bucket; skill description evidence and unresolved interactions remain separate.

## Reina S2: SwiftJive

The same six-outcome entry supports a variable defensive contribution: omitting S2 predicts a constant1710 attackers; allowing dodges only against enemy Infantry predicts1709.194±5.319, and both fail versus current1403.836±119.608. The Flint/Reina/Zinman and Reina/Logan contexts likewise reject omission and enemy-Infantry-only triggers. This supports responses to attacking sources beyond enemy Infantry.

Positive protection of own backlines is weaker. Restricting recipients to own Infantry remains plausible in the six-outcome entry (1467.300±102.698,p=.011549) and most other sets. One Sergey/Reina observation rejects that restriction at p=.0012 versus currentp=.670666, but this single mixed-kit outcome is insufficient to close all recipient-scope interactions. The new five-battle S3 case accepts S2 omission, confirming its limited power for the small dodge contribution.

The earlier [alternate-semantics review](../reina-alternate-semantics/README.md) separately disfavored specific shared/reactive round-dodge replacements, including on S3-locked observations. Those are existing comparisons, not new independent battles in this package. Exact proc chance, kind/delivery interactions, cancellation of accompanying extra jobs, target exhaustion and full level curve remain unresolved. The production TBD notes are retained.

## Integrity and limits

`summarize.py` checks all per-class survivor sums, A−D values, sample counts, means, SDs, deterministic errors and identical current samples for inputs shared between skill reviews. Frozen source/config hashes stayed unchanged. Traced modifier applications establish simulator execution; only game outcomes and meaningful counterfactual separation support game mechanics. Low p-values for tiny endpoint shifts still require the user's battle-scale accuracy judgment.

```sh
simulator/node_modules/.bin/tsx docs/mechanics-audit/reviews/philly-reina-2026-09-07/worker.mts VigorTactics NEW_SUFFIX 1000
python docs/mechanics-audit/reviews/philly-reina-2026-09-07/summarize.py
```

Use the other IDs in the protocol for additional replays. The worker refuses existing output and changed frozen sources. This is an active-corpus review, not an exhaustive archived-outcome search. Separate input entries and overlapping skill appearances are not assumed independent battles.
