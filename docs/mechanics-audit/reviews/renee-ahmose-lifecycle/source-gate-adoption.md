# Ahmose Viper: living Infantry required for new protection

> Superseded implementation (2026-09-08): turn triggers are source-free again. Viper creates its Infantry pause every fourth turn; only actual `no_attack` use creates protection, delayed until the next turn for two full turns. The two captures below remain evidence against unconditional protection, but do not distinguish a source gate from this use-dependent model. The historical comparisons below retain their original configuration and results.

Two prospective full-kit Ahmose1/1/0 captures support a source requirement that the old simulator omitted. Predictions and stat sensitivity screens were frozen before observing either result; no coefficients or inputs were fitted.

| Formation | Game | Before correction | Corrected production |
|---|---:|---:|---:|
|240 T6 Lancers versus125 T6 Infantry; no own Infantry|Defender11|Attacker15|Defender11|
|1 T6 Infantry +480 T6 Lancers versus250 T6 Infantry|Attacker3 Lancers|Attacker61 Lancers|Attacker3 Lancers|

The [first capture](../../probes/ahmose-no-infantry/README.md) rejects protection without Infantry initially. The [follow-up](../../probes/ahmose-no-infantry/source-death/README.md) rejects allowing initial Infantry presence to sustain later activations: both frozen traces exhaust the single Infantry after only two normal attacks, before any candidate could start protection. Its actual death turn is a simulator inference, not a game observation. Both reports display a dash for Viper activations; that remains null in the recorded evidence.

Production now gives Viper's turn trigger an explicit Infantry source requirement. A new activation requires living Infantry at that scheduled turn. Already activated effects keep their duration; source-less turn skills retain their scheduling. The existing every-four-turn cadence remains a provisional representation. These captures do not distinguish it from an attack-dependent cycle while Infantry survive, and the ambiguous skill description does not settle that question.

The [production replay](source-gate-adoption.json) exactly matches all303 frozen private-candidate results, including297 non-Ahmose inputs unchanged against the old engine. This compares one identical seed per input across winner, rounds, all survivor counts, skill reports, effect activations and randomness metadata. It is a structural regression check, not fresh distribution validation of every stochastic case. Both new fixtures also replay exactly from their saved accepted inputs.

| Existing accepted input | Game attackers | Before | After |
|---|---:|---:|---:|
|Ahmose solo|2633|2615|2640|
|Renee/Ahmose attacker overlap|3777|3778|3778|
|Archived strong Renee/Ahmose defender|2810|2574|2709|
|Archived weaker Renee/Ahmose defender|1631|1622|1633|

The strong archived case still has101 unexplained survivors of error; Ahmose is not fully resolved. A conditional S2 re-review gives solo2640 with Prayer of Flame versus2659 when omitted, and1943 when broadened to all own classes. Its former omission result2634 was a near-fit under the old unconditional Viper model. In the clean attacker case, current3778, omission3756 and all-own3872 remain unchanged. The prior review is preserved; source gating removes that particular apparent argument for omitting S2 without identifying every S2 parameter.

Validation: all219 simulator tests and typecheck pass. Seven added tests cover absent and dead sources, retained protection duration, source-less scheduling, source arrays, source relation, and both captured outcomes. Test behavior is an implementation contract, not independent game evidence for every generic selector edge case.

Reproduce with `npx --yes tsx docs/mechanics-audit/reviews/renee-ahmose-lifecycle/source-gate-adoption.mts NEW_OUTPUT.json` (writes an immutable result; supply an unused output filename). [The result](source-gate-adoption.json) records the production source hashes; [the private comparison](source-gate-results.json) and its [protocol](source-gate-protocol.json) retain the pre-adoption evidence.
