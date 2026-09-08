# Full Hendrik trace: troop matchup bonus inheritance

**Set aside following Paul's review.** Reusing source-only arithmetic does not justify retaining target-dependent matchup bonuses. The rock-paper-scissors scope and adverse Gwen results weigh against adopting this explanation. The experimental results remain preserved, but this is not the active correction proposal; revisit only with further discriminating evidence or a better-supported mechanism. Investigation returns to the actual fanout implementation and other explanations.

Paul requested inspection of the actual round-by-round battle rather than further weakly motivated timing alternatives. He emphasized that established global evidence and a simplified physical battle should constrain proposed mechanics. The complete [current-engine traces](full-traces.json) and [round ledger](round-ledger.json) retain the existing normal-then-extra attack order and S3's ordinary3/6/9 schedule.

## What the trace shows

All enemy troop lines survive both Marksman battles. There are no stuns or attack cancellations to explain a missed S3 activation. S2 supplies18% Defense to all incoming attacks during rounds4/5,8/9,12/13 and so on. The first battle reaches round20 with5.832 fractional Marksmen; the smaller reaches round32 with0.282 and ends there. The smaller game's S2/S3 counts8/11 imply33–35 rounds under the usual complete-count interpretation, exposing a survival discrepancy as well as the damage residual.

In the first battle on round3, the normal Marksman attack kills5.694 Infantry. S3 then kills1.367 Infantry,3.893 Lancers and5.179 Marksmen. Its Infantry hit is exactly24% of the normal shot. Both Infantry hits include the native Ranged Strike10% bonus; the two backline S3 hits do not. Their separate Health/Defense values still enter each damage calculation.

The observed backline losses in the first battle are compatible with roughly10% more S3 damage. Ignoring battle feedback, the two integer survivor counts jointly allow a common uplift of approximately6.9–11.4% over the modeled backline damage. That suggests a concrete question: whether the additional attack carries the triggering normal attack's troop matchup bonus, while still using each recipient's own defensive stats.10% is the configured native troop bonus, not a fitted value. This is an engine hypothesis motivated by the trace, not a claim that a bonus against Infantry ought physically to apply against every troop class.

## Frozen retrospective candidate

[The protocol](trait-protocol.json) names a general rule before the new candidate results: same-source generated attacks use their accompanying normal attack's target to select the three native10% matchup traits (Master Brawler, Charge, Ranged Strike). Every other modifier, target defense, coefficient, attack order and cadence stays unchanged. All recorded game outcomes were already known. The runtime archive and complete inputs/config are frozen; no production implementation was edited.

| Battle | Game survivors I/L/M | Ordinary first3 | Trait-inheritance candidate | Game and candidate S2/S3 |
|---|---|---|---|---|
|250M vs400I/100L/100M|313/82/76|314/84/78|**313/82/76**|**5/6**|
|250M vs150I/60L/60M|16/31/21|19/34/25|**16/31/21**|**8/11**|

The first candidate battle lasts20 rounds; the second now lasts33. More backline damage reduces return fire and lets Hendrik's Marksmen reach their eleventh correctly scheduled S3 activation. Thus both exact survivor vectors and both reported activation counts fit without starting S3 early. The Lancer-only game17 and historical S3-locked Renee/Hendrik game14 remain unchanged. [Traced reports and statistical summaries](trait-summary.json) verify these figures.

## Global counterevidence

The rule was tested across all301 active inputs under a shared seed per input.285 were unchanged;16 changed, including five deterministic cases. Both Hendrik cases improve, but all three deterministic Gwen cases worsen:

| Gwen game outcome | Baseline | Candidate |
|---|---|---|
|Defender563|Defender534|Defender507|
|Defender1397|Defender1388|Defender1384|
|Defender24|Attacker76|Attacker112|

Those Gwen baselines already disagree with the game, so this is adverse evidence rather than a clean isolation refuting inheritance itself. It nonetheless prevents treating the two Hendrik matches as a sufficient explanation of the corpus. A Hendrik-only exception has not been introduced or independently established.

Every one of the11 affected stochastic inputs received1000 shared-seed runs under each model. The accepted observations remain plausible under both models at the existing raw distribution threshold; candidate p-values range0.034698–0.9999. These samples cannot establish unchanged distributions or rule out smaller discrepancies. Some fixtures have only one observed battle. The full draws, samples and deterministic traces are preserved in [compressed results](trait-followup.json.gz); [the summary](trait-summary.json) records its uncompressed SHA256.

This is a substantially better Hendrik lead than changing the global attack order or moving an every-three-turn skill to turn2. It remains an unresolved modifier-inheritance hypothesis. The next question is whether the native troop bonus follows the triggering attack in a way consistent with the other multi-target skill evidence, including the unresolved Gwen mechanics. No global rule or hero-specific exception has been adopted.
