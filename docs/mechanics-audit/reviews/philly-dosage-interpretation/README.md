# Philly dosage wording challenge — 2026-09-07

**Philly's accepted battles support the inclusive-total reading of its skill description. They do not establish that Reina uses the same rule.** This is a retrospective challenge to interpreting every displayed120–200% as additional damage. It changes no production code; a bounded level2 magnitude annotation is recorded in the reviewed-evidence ledger.

The [live level2 skill description](../../hero-tooltips/minxxx-philly-2026-09-07/skill_2-panel.png), visually inspected after capture by the parent agent, says all troops' attacks have a25% chance of dealing140% damage, with preview120/140/160/180/200%. The [current Philly definition](../../../../simulator/config/hero_definitions/Philly.json) instead supplies20/40/60/80/100 to `extra_skill_attack`, while the ordinary attack still executes. Thus level2 currently means normal100 plus skill40, not normal100 plus skill140.

[replay.mts](replay.mts) compares all eight accepted entries containing Philly:25 recorded outcomes, unchanged full kits, exact stats, troop keys and inputs. It samples1,000 battles per entry per candidate,24,000 total. [results.json](results.json) preserves every margin, per-type survivors, winner, rounds, exact inputs and hashes. All recorded outcomes are accepted irrespective of folder unless explicitly invalid/obsolete; none of these entries has such an exclusion. Different entries/copies are not asserted to be independent repeats of the same setup.

The three candidates are:

- **Current increment:** normal100 plus separate skill20/40/60/80/100.
- **Full displayed coefficient as additional damage:** change only the extra-job coefficient to120/140/160/180/200.
- **Normal increment:** retain20/40/60/80/100 but apply it to the triggering normal attack for one attack, without an extra skill job. At level2 and absent other modifiers this is normal140. Existing normal-factor modifiers still combine under the engine's current rules; this is a defined counterfactual, not a universal translation rule.

Scores below are surviving attackers minus defenders, including draws. Every ± is simulator per-battle SD. Values use the same existing distribution comparison as the testcase runner; raw p<0.004 is its diagnostic threshold, not a unique-mechanism proof.

| Accepted entry / stored game margins | Current increment mean±SD; p | Full displayed coefficient as additional damage mean±SD; p | Normal increment mean±SD; p |
| --- | --- | --- | --- |
| Mixed hero entry#5 / −2295 | −2271.52±9.79; .020449 | −2311.69±11.71; .183641 | −2273.98±9.78; .029649 |
| Philly solo#0 /2254,2252 |2251.29±84.91; .623119 |438.43±586.35; .000050 |2251.75±84.62; .611919 |
| Philly solo#1 /3606,3637,3616 |3622.54±12.47; .723664 |3519.45±35.60; .000050 |3622.54±12.47; .723664 |
| Philly/Bahiti#0 /−556 |−558.38±1.90; .446378 |−564.02±3.09; .015599 |−558.65±1.84; .214039 |
| Philly/Bahiti#1 /−463,−456,−455,−459 |−454.20±4.44; .177541 |−477.45±7.61; .000050 |−455.43±4.50; .424529 |
| WOS425 Philly defense /769,769,769,768,768 |768.34±.61; .732113 |761.01±1.89; .000050 |768.34±.61; .732113 |
| WOS425 Sergey/Philly /738,738,738,738,739 |737.78±.88; .386581 |723.21±3.04; .000150 |737.78±.88; .386581 |
| WOS427 Sergey/Philly840 /24,7,32,27 |4.15±29.76; .294235 |−271.10±21.00; .000050 |4.15±29.76; .294235 |

The current increment is compatible with all eight comparisons; treating the full displayed coefficient as additional damage fails six. The clearest isolated offensive test is WOS425 Philly defense: only Infantry participate and Philly is the sole hero, full220 kit. Its repeated769/768 outcomes agree with extra40 while extra140 shifts losses substantially. In WOS427, full Sergey22 and Philly220 are retained: ordinary140/extra40 permits the observed small attacker victories; extra140 predicts a substantial defender victory.

The strongest contrary observation is the mixed-hero entry with level1 Philly: the full-coefficient candidate is closer in distribution than current. It contains six heroes, including several chance skills, and one recorded outcome; both alternatives remain compatible. It is retained, not excluded to improve the story. The first Philly/Bahiti outcome also remains compatible with full-skill description additional. These limits prevent treating every fixture as an independent, clean Philly magnitude isolation, but they do not remove the clear failures in the simpler repeated setups.

**Delivery is not settled.** Current extra40 and normal+40 reproduce identical1,000-score samples in both WOS425 Infantry fixtures, WOS427 and Philly solo#1. Both delivery models are compatible in the other reviewed cases too. A separate skill job can differ from a boosted normal attack when normal-only/skill-only modifiers, shields, dodges or capped target damage intervene. No new game evidence here isolates those differences. The main supported numerical level is2; the sole level1 comparison is confounded, and levels3–5 were not exercised.

For Reina, the parent preserved a separate five-battle level1 experiment. Philly establishes that subtracting the ordinary100 from this kind of displayed percentage can be correct; its skill description alone cannot settle Reina's explicitly described extra attack. Likewise, a typical20–25% level5 skill impact is a useful prior, not proof: scope differs between all troops and only Lancers. The Reina decision must rest on its own preserved observations and comparisons, including competing S1/S2 or delivery explanations. This note neither confirms nor reverses its production coefficient.

Reproduction uses `simulator/node_modules/.bin/tsx docs/mechanics-audit/reviews/philly-dosage-interpretation/replay.mts` in a fresh copy of this artifact directory. The script refuses an existing result/snapshot and checks the29 runtime source hashes and full configuration before completion. Its frozen [config-snapshot.json](config-snapshot.json) includes the parent's120..200 Reina definition, but no selected input includes Reina. No fitted stats, effect disabling in game, rerun selection or single-sample stochastic verdict was used.
