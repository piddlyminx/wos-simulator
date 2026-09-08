# Logan, Ling and Lumak: bounded deterministic review — 2026-09-07

**Seven distinct recorded outcomes agree within one troop. Three skills gain contextual enemy-scope support; Logan's other two skills gain protective-contribution evidence without establishing backline scope or stat grouping.** All recorded outcomes are accepted unless explicitly invalid or obsolete, irrespective of their folder. These entries have no such exclusion. The comparisons are retrospective, preserve full recorded kits and exact inputs, and change no combat code.

[replay.json](replay.json) contains exact inputs, survivor totals, winner, rounds, relevant simulated effect applications, omission/scope/grouping predictions and file hashes. [summary.json](summary.json) counts seven distinct deterministic fixture entries and seven stored outcomes: five exact, two with simulator attacker survivors one below the game. The eleven per-skill fixture rows overlap and are not eleven separate battles. Thirteen distinct stochastic full-kit entries are listed as skipped; their historical `nc` names/descriptions do not override the runtime's active chance skills. No conclusion here rests on one random simulation.

All troops in the seven reviewed entries are T6. Ling/Lumak fixtures preserve both canonical names and aliases (`Ling Xue`, `Lumak Bokan`). Their second configured skill is an empty noncombat placeholder, which does not acquire combat evidence from these outcomes. Exact report stats are retained without added generation bonuses or fitting.

## Enemy debuffs

The scope alternative keeps the effect value and all other skills, but limits the debuff to enemies of the hero's troop class: Infantry for Logan, Lancers for Ling/Lumak. The table uses A/D to identify the winning side and its remaining troops.

| Skill / full recorded kit / fixture | Game | Current | Omit selected skill | Narrow enemy scope |
| --- | ---: | ---: | ---: | ---: |
| Logan LionStrike / Logan333+Gwen110 /`logan_gwen_combo_nc#0` |D403 |D403 |D292 |D309 |
| Logan LionStrike / Logan333 /`logan_solo_v2_nc#0` |D1134 |D1134 |D1126 |D1127 |
| Logan LionStrike / Logan100 /`logan_solo_minxxx_nc#0` |D1995 |D1995 |D1995 |D1995 |
| Ling FearsomeAura / Ling11 /`ling_xue_solo_nc#0` |A2822 |A2822 |A2880 |A2859 |
| Ling FearsomeAura / Ling Xue11 /`ling_xue_solo_nc#1` |A3215 |A3214 |A3244 |A3242 |
| Lumak TacticalDeception / Lumak11 /`lumak_bokan_solo_nc#0` |A2797 |A2797 |A2837 |A2834 |
| Lumak TacticalDeception / Lumak Bokan33 /`lumak_bokan_solo_nc#1` |A3127 |A3126 |A3234 |A3204 |

Logan333/Gwen110 is the strong Logan discriminator. Attacker600I/600L/600M faces defender200I/200L/200M: preserving contributions from all three enemy classes agrees, while restricting LionStrike to enemy Infantry loses94 more defenders. This is conditional on the recorded Gwen110 kit and other current mechanics. The large solo Logan333 army provides a smaller confirming difference. The Logan100 battle applies the modeled effect to attacks but its final endpoint is identical without the skill; it does not independently establish level1 magnitude or even require that contribution at this resolution.

Both Ling setups use attacker1500I/1069L/1500M versus defender200 of each class at different stored stats. The Lumak setups use the same troop counts at their own stored stats and skill levels1/3. Omitting or narrowing the debuffs changes the endpoints by29–108 troops, compared with current residuals0–1. These support contribution beyond enemy Lancers in these normal-attack contexts. They do not establish every possible target/source interaction or a complete five-level curve.

**The exact stat grouping is not identified.** Replacing Logan/Ling AttackDown with DamageDown or LethalityDown produces the same endpoints throughout the reviewed deterministic fixtures. Replacing Lumak DamageDown with AttackDown or LethalityDown is likewise indistinguishable. The full raw predictions retain this negative result. Scope evidence must not be repurposed as proof of a unique damage formula or grouping rule.

## Logan's two defensive buffs

| Selected skill / fixture | Game/current | Omit only selected skill | Own Infantry only | Alternative grouping |
| --- | ---: | ---: | ---: | --- |
| LionIntimidation lvl3 / Logan333+Gwen110 |D403 |D292 |D403 |Health D400; Defense D403 |
| LionIntimidation lvl3 / Logan333 solo |D1134 |D1126 |D1134 |Health D1133; Defense D1134 |
| LeaderInspiration lvl3 / Logan333+Gwen110 |D403 |D270 |D403 |DamageTaken D400; Defense D403 |
| LeaderInspiration lvl3 / Logan333 solo |D1134 |D1124 |D1134 |DamageTaken D1133; Defense D1134 |

There is clear endpoint evidence for a protective contribution from each selected effect when all other recorded skills are retained, especially in the Logan/Gwen battle. That does not identify the advertised all-troop recipient scope: **only the defender's Infantry receive attacks in both setups**, and the Infantry-only counterfactual is exactly equivalent. Defense-group alternatives are also exactly equivalent. The remaining1–3 troop differences between current and the other grouping are too modest and dependent on shared full-kit assumptions to establish a general stat-grouping rule.

These two annotations therefore retain the observed protective contribution in their context text but do not mark a whole scope, damage-kind, coefficient curve or grouping dimension as supported. No level other than3 was exercised for either skill in this bounded deterministic review. Exact timing, normal-versus-skill protection, troop exhaustion, joiner/rally ownership and widget effects remain unreviewed.

## Reproduction

[replay.mts](replay.mts) uses the current adopted fractional outer army term while retaining ceiled surviving source troops. It computes surviving attackers minus defenders for every endpoint, including draws, and retains both sides/winner. The frozen [configuration](config-snapshot.json), current definition hashes and runtime source hashes are recorded. The script rejects existing output or changed inputs/config/runtime. To produce a separate replay, use a fresh copy of this directory with an unused output name; preserve this snapshot and results.

No production definitions, game fixtures or live account state were changed. The five-skill ledger records contextual findings and remaining gaps; complete-kit agreement alone is not certification of every skill or nested effect in that kit.
