# Expedition mechanics evidence audit

Started 2026-09-07. This is an ongoing audit, not a claim that the simulator is fully validated.

The objective is to support every defined hero and troop battle skill with captured game evidence and resolve material disagreements. Scope includes timing, target/source restrictions, damage classification, magnitude, duration, stacking, chance behavior, and solo/rally/garrison roles where applicable. Empty economic skill definitions are listed separately.

## Evidence standard

- All recorded game outcomes are accepted evidence regardless of folder, as Paul clarified on 2026-09-07, unless explicitly flagged invalid or obsolete. Missing images, age, and disagreement with the simulator do not invalidate an observation. Preserve images for new captures when available.
- Deterministic outcomes: aim for the correct winning side and survivor count within  0.1% of the total units that start the battle. Errors above 0.1% are investigation diagnostics, not universal hard failures; a percentage PASS alone is also insufficient. Prefer probes with substantial separation between competing predictions.
- Stochastic outcomes: compare the individual game observations with the simulated outcome distribution. Collecting results in game is time expensive and realistically we will not get as many as we would idealy have to reach very high confidence. 5 or maybe 10 samples if variance is high are usually enough to establish tne game outcomes fall in the right range and have a realistic spread: it's not proof, but it's good enough. We achieve confidence through observing a large number of weak signals across many skills all pf which a driven by the same Skill/Effect model. Each weak signal increases confidence in the model, and thus indirectly all the other skills. Preserve samples and report sample size; collect more game observations where uncertainty prevents a useful conclusion.
- Keep displayed-input predictions separate from fitted/adjusted-input predictions. The runner's automatic uniform stat adjustment is a sensitivity probe; it does not establish an independently verified input or a complete uncertainty envelope.
- A skill being configured or hydrated is not evidence that its relevant mechanic was exercised. Full-kit endpoint agreement supports the exercised combination; it does not identify every individual effect.
- Freeze candidate behaviors and conditional predictions before opening new results. Report fresh inputs and any resulting prediction changes explicitly. Preserve full kits and exact troop/FC identities.
- Fix mechanics after checking the recorded inputs, actual skill levels and competing causal explanations. Existing accepted fixtures do not need their provenance re-established. Preserve contradictory observations.
- Keep numerical patterns connected to the [physical battle interpretation](physical-interpretation.md): use crowding, formation protection, source survival and committed attacks to select falsifiable hypotheses, then judge them against game evidence. Track exact agreement and where residuals arise, not only aggregate improvement counts.

The detailed [capture and comparison policy](../../skill/knowledge/testcase-evidence-policy.md) and [full-kit experiment guidance](../../skill/knowledge/skill-isolation-with-fixed-hero-kits.md) apply. Live control is limited to `minxxx` and `WIP` through `wosctl`.

## Starting inventory and baseline

The initial inventory contains **39 heroes, 140 hero skills, and 12 troop skills**. Five definitions have no battle effects. Of the remaining 147 definitions, 63 have no active fixture that hydrates them. Thirty-one of these are rally/garrison widget skills; those are all skill_4 and are not included in this audit.They have been separately validated as they work a little differently. They all work similarly varying only in the side that they activate for and the stat they buff. They multiply with all active runtime effects and add with other city/pet buffs of their type.

The initial corpus contains 289 cases and 602 stored outcome records. These records have not all been verified as independent observations. Use `path#index` as the identity: test IDs are not unique.

The fresh 1,000-sample baseline found:

| Check | Initial result |
| --- | ---: |
| Cases executed without errors/warnings | 289 |
| Simulator-deterministic / stochastic cases | 170 / 119 |
| Deterministic cases with a raw per-observation residual above 2 troops | 48 |
| Still above 2 after the runner's stat adjustment | 13 |
| Of those 13, cases displayed as PASS | 11 |
| Raw stochastic discrepancies retained at 10,000 simulation samples | 4 |
| Stochastic cases with fewer than five stored game observations | 87 |

No adjustment or sample-count threshold alone establishes mechanic agreement. See [baseline notes](baseline/baseline-notes.md) for commands, individual observations, raw samples, and the distinction between raw and reported results.

## Working files

Two large generated JSON traces are stored as gzip archives. See [archive restoration instructions](archives.md) before opening their original JSON paths or rerunning the associated reviews; extraction preserves the recorded bytes and hashes.

- [Skill inventory](skills.csv): every defined skill, fixture presence, levels and initial review status.
- [Full inventory](inventory.json): definitions, nested effects, exact fixture keys, hashes and accepted-evidence status.
- [Inventory notes](inventory-notes.md): missing mechanics and what the generated coverage does and does not establish.
- [Baseline audit](baseline/audit.json): per-case disagreements and observation counts.
- [Earlier mixed-target evidence](../mixed-target-parity-investigation-2026-08.md) and [attack timing evidence](../attack-trigger-regime-2026-08.md): preserve established discriminators and rejected explanations. Recheck current definitions before reusing historical numerical predictions.

Regenerate inventory with `npx --yes tsx scripts/audit_mechanics.ts`. Generated inventory status describes fixture presence; [reviewed annotations](reviewed-evidence.json) retain contextual mechanic conclusions and dated evidence notes across regeneration. Definition changes flag prior conclusions for rechecking.

## Current work

| Work item | Status / next evidence |
| --- | --- |
| Gwen Blastmaster | Three new full-kit3/1/1 T6 probes. The [small550-vs900 capture](probes/gwen-small-timing-550/README.md) gives defender24 versus current attacker76 with exact fresh inputs. Frozen timing/source-count alternatives and subsequent [modifier alternatives based on skill descriptions](reviews/gwen-tooltip-scope/README.md) all retain contradictions; no skill change adopted. Both earlier1397/563 outcomes remain accepted. The30k/five-survivor onset design was withdrawn before deployment. |
| Wu Ming | [Reviewed accepted fixtures](reviews/wu-ming-2026-09-07.md) support contextual normal-damage branches and S3 normal-damage exclusion. Positive skill-kind effects remain open. The [outer-ceiling correction](reviews/outer-army-ceil/adoption.md) resolves the archived19-survivor discrepancy exactly. |
| Hendrik Armor of Barnacles | [New capture](probes/hendrik-armor/README.md): game/current17 defending Lancers. Supports S2's Lancer protection and negative S3 source scope; exact phase, defensive bucket and positive S3 behavior remain open. |
| Sonya | [Full-kit1/1/0 capture](probes/sonya-buffs-cadence/README.md): game/current1175, including exact175/200/800 line counts and51 reported S2 activations. Supports the exercised S1/S2 combination; some bucket and timing alternatives remain indistinguishable. |
| Reina Shadow Blade | [Five verified battles](probes/reina-shadowblade/README.md) give166/163/163/157/174 defenders, mean164.6 and SD6.19. The configured20% extra model predicts179.17/SD1.97; the corrected120% level1 model is plausible (fresh run162.73/SD6.52,p=.633). Higher120/140/160/180/200% values come from the displayed curve and remain untested in battles. [Philly's similar wording](reviews/philly-dosage-interpretation/README.md) has a different evidence-supported total-damage interpretation. [Paul confirmed both are skill damage](damage-kind-confirmation-2026-09-07.md); unexercised modifier interactions remain open. |
| Hendrik Dragons Heir | Ordinary first3/every3 is retained. The [joint counts](reviews/hendrik-count-consistency-2026-09-08/README.md) favor it over first2. A [full-trace modifier-inheritance candidate](reviews/hendrik-count-consistency-2026-09-08/trace-review.md) now exactly reproduces both game survivor vectors313/82/76 and16/31/21 and S2/S3 counts5/6 and8/11, with20/33 simulated rounds. It carries the triggering normal attack’s native10% troop matchup bonus into S3. A general rule worsens three existing Gwen mismatches;11 affected stochastic cases remain plausible in1000-sample comparisons. No global change or Hendrik-specific exception has been adopted. |
| Edith Infantry effects | [Completed full3/3/3 Infantry-only capture](probes/edith-ironclad/README.md) gives game/current102 surviving enemy Marksmen. Omitting S2 predicts146 and omitting S3 predicts155, supporting both positive Infantry branches with verified fresh stats, counterpart troop rows and all three skill descriptions. S2's Defense grouping alternative remains indistinguishable in this context. |
| Core casualty and attack arithmetic | [Gatot evidence](gatot-fractional-state.md) supports fractional state carrying between rounds and full attack strength for a partly damaged surviving troop. Both remain intact; only an additional outer ceiling around the square-root army term was removed. |
| Reachable missing skills | [The26 fixture-applicability gaps in scope](remaining-gaps/README.md) comprise21 ordinary skills on seven unowned heroes,3 locked ordinary skills and2 FC Marksman skills. The31 skill_4 widgets are separately validated and excluded from this audit. All currently unlocked ordinary skills have fixture hydration; causal support remains a separate review. |
| Greg S2 | [Five new verified full110 battles](probes/greg-deterrence/README.md) give defenders113/108/109/113/110, mean110.6. Current111.049/SD4.326 is plausible (p0.840858); S2 omission124.271/SD2.833 fails (p0.000100). Supports positive contribution from Infantry attacks; exact chance, duration, scope and stacking remain open. The seven older input sets did not distinguish omission. |
| Ahmose Viper Formation | [Two prospective captures](reviews/renee-ahmose-lifecycle/source-gate-adoption.md) reject unconditional protection: no Infantry gives game/current defender11; one Infantry exhausted early gives game/current attacker3. Turn triggers are source-free; Viper schedules a one-turn Infantry pause every fourth turn, and only actual pause use creates its two protection effects, starting next turn for two full turns. All four active Ahmose fixtures retain their survivor results in the 2026-09-08 before/after replay. The captures do not identify this internal lifecycle uniquely; exact cadence and protection timing remain provisional. |
| Existing deterministic disagreements | The [fresh296-case production run](reviews/reina-extra-attack-magnitude/production-validation.md) has176 deterministic cases,25 with raw errors above2. The two additions are Gwen550 and Hendrik Marksmen; all174 shared deterministic vectors are unchanged after Reina's correction. These counts are diagnostics requiring battle-scale judgment. |
| Existing stochastic disagreements | Four pre-existing concerns are flagged among120 stochastic cases in the fresh296-case run; the preceding293-case run flagged three with different simulation seeds. The new five-outcome Reina case is plausible. Preserve raw samples and earlier comparisons; threshold crossings from resampling are not themselves mechanic regressions. The [FC audit draw-score correction](reviews/fc-troops/draw-correction/README.md) preserves both armies and supersedes affected audit metrics without changing production scoring. |
| Flint historical cases | Review mechanic-era provenance: varying 2025 observations remain in currently deterministic fixtures. Historical comments are leads, not proof for deleting evidence. |
| Rally/garrison and joiner behavior | Ordinary-skill role behavior remains a separate evidence dimension. Skill_4 widget validation is outside this audit as clarified above. |
| Crystal Gunpowder / Flame Charge | No active fixture hydration. The [targeted source search](marksman-fc-evidence-search.md) found input-only screenshot leads but no complete validating battle. [Direct inventory inspection](reviews/marksman-fc-availability/README.md) found T9 Supreme Marksmen at most on both authorized accounts, without FC emblems; the current formations cannot exercise these FC3/FC8 skills. |

All90 nonempty skills that currently hydrate in the active corpus now have contextual review annotations. This is a review milestone, not full validation: unresolved dimensions and contradictions remain. The latest [nine-skill review](reviews/remaining-ordinary-2026-09-07/README.md) adds Lynn, Norah, Molly S3 and Natalia S1/S2 evidence; Lynn S3 contribution and the mixed-kit Natalia discrepancy remain open. The [counter-model note](physical-interpretation.md) preserves Paul's community-informed understanding and reported deterministic fit support, with its limits.

The audit remains open until each relevant mechanic has reviewed evidence and no unexplained material mismatch remains. Unavailable skills and mechanics not exercised by accepted evidence remain explicit gaps.
