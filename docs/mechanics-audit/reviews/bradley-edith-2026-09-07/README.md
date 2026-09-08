# Bradley and Edith — reviewed 2026-09-07

This **retrospective** review covers Bradley S1/S2/S3 and Edith S1/S3 with accepted existing game outcomes. All recorded full kits, stats, troops and battle options are preserved. Omission, scope, bucket and timing changes exist only in cloned simulator configs. No live battle, stat fitting or production change is part of this review.

[replay.json](replay.json) preserves every input, observation, result and effect application count; [replay.mts](replay.mts) records the candidate definitions and source guards. [config-snapshot.json](config-snapshot.json) is the complete frozen config, and [summary.json](summary.json) derives the counts. The replay retains fractional survivors and ceilings surviving source units for attack strength; the separate outer army-term ceiling was already removed.

There are **nine distinct fixture entries and nine stored outcome rows**: seven exact endpoints and two existing Gatot/Bradley residuals. All nine hydrate deterministically in this frozen runtime. The seven Bradley cases overlap across all three skills and are not 21 independent observations. Several entries were already used in earlier hero/troop reviews; using them for a different mechanic does not create new game evidence. Every reviewed application of the selected effects is to normal damage.

The parent subsequently corrected Reina's Shadow Blade coefficient curve. This replay and full-config snapshot remain unchanged. None of these nine inputs contains Reina, and the Bradley/Edith definitions and combat runtime used here are unchanged. Future replay must respect the frozen guards rather than silently replacing the full snapshot.

## Bradley: contribution, scope and pooling

The strongest small-endpoint comparison is [Wu Ming + Bradley](../../../../testcases/emulator_verified/wu_ming_bradley_current_nc.json): attacker Wu Ming 3/3/3 and Bradley 4/4/4 with 170 of each T6 class against 900 Infantry and 900 Lancers. Game and current model leave **112 attackers**. `A`/`D` below identifies the surviving side.

| Selected skill varied in this same full kit | Current/game | Omitted | Marksman-only scope | Named bucket alternative |
| --- | ---: | ---: | ---: | --- |
| S1 Veteran's Might | A112 | D635 | A82 | Damage pool A77; Lethality pool A112 |
| S2 Power Shot | A112 | D642 | A81 | Hero Damage pool A92; normal-damage pool A112 |
| S3 Tactical Assistance | A112 | D342 | A98 | Attack pool A98; normal-damage pool A114 |

These comparisons support each skill's contribution beyond Marksmen in this context. S1 is favored as separate from the existing Damage pool, but Attack versus Lethality is indistinguishable throughout the reviewed corpus. S2 is favored as separate from the hero Damage pool in this kit. Neither result uniquely proves a bucket label or every stacking interaction.

Power Shot has separate Lancer and Infantry target effects. In the Wu/Bradley case, omitting only the Lancer branch gives **A72** and omitting only the Infantry branch gives **D572**. Broadening the Lancer branch to every enemy type gives **A251**; broadening the Infantry branch gives **A131**. This supports both contributions and their tested target restrictions, conditional on the complete kit. Its Lancer effect enters jobs in four of seven reviewed entries and its Infantry effect in six of seven; hydration alone is not treated as use of every branch.

The [single-target Lancer](../../../../testcases/emulator_verified/wos451_bradley_s21_lancer_damage_up_bucket.json) and [single-target Infantry](../../../../testcases/emulator_verified/wos451_bradley_s22_infantry_damage_up_bucket.json) fixtures give game/current **A2736/A2746**; omitting the corresponding Power Shot branch gives A2723/A2738 and omitting the other branch changes neither result. These are further branch checks, although the 8–13 troop shifts are small relative to these endpoint totals. Full Flint 1/1/0, Jessie 1/1 and Bradley 4/4/4 kits remain intact; these point matches do not independently establish Flint's variability model.

Replacing Power Shot's single-target pool with the normal-damage pool changes [Bradley alone](../../../../testcases/emulator_verified/wos444_bradley_s3_all_troops_damage_hero_nc.json) from game/current **A8117 to A8174** and the first Gatot case below from current D2274 to D2086 against game D2296. This favors the current pooling over that particular alternative, with the Gatot residual retained. It does not demonstrate skill-kind delivery: explicitly restricting the current effects to normal kind changes none of the seven Bradley predictions, because the reviewed effect applications are already normal jobs.

## Bradley S3 timing

| S3 timing alternative | Wu/Bradley game A112 | Bradley-alone game A8117 |
| --- | ---: | ---: |
| Current: first turn 4, every 4, two-turn window | A112 | A8117 |
| First turn 1, then every 4 | A113 | A8173 |
| Delay each current window one turn | A97 | A8116 |
| One-turn window | A73 | A8112 |

The Wu/Bradley endpoint supports the current two-turn window over the one-turn and delayed-window alternatives in this kit. First-turn-1 remains within one troop there; its 56-unit difference in the larger Bradley-alone endpoint is a weaker scale-relative comparison. Exact onset, complete cadence behavior and interrupted attacks remain unverified. One short Lancer-target fixture exercises S3 but gives the same rounded endpoint when it is omitted, illustrating why activation plus a fit is insufficient by itself.

The [earlier investigation](../../../mixed-target-parity-investigation-2026-08.md) also records close but imperfect per-source attribution for Wu/Bradley. Its conclusion that small source differences can cancel remains relevant: this aggregate match does not certify every source contribution.

## Existing Bradley residuals remain

| Accepted full-kit fixture | Game | Current | Residual |
| --- | ---: | ---: | ---: |
| [Gatot/Bradley S10](../../../../testcases/gatot_verified/s10-bradley-1000-inf-125-marksman-vs-5000-inf.json) | D2296 | D2274 | 22 fewer defenders |
| [Gatot secondary heroes S15.2](../../../../testcases/gatot_verified/s15.2-secondary-heroes-1000-inf-125-lancer-125-marksman.json) | A851 | A834 | 17 fewer attackers |

These are about 1% and 2% of the recorded endpoints. They remain unresolved without automatically declaring them material solely because they exceed two troops. Individual alternatives sometimes improve one residual while harming other cases: S2's hero-Damage pool improves A834 to A842 in S15.2, but worsens the exact Wu/Bradley A112 to A92. No Bradley change is justified from that isolated improvement. In S15.2 the config counterfactual affects Bradley on both sides; it is not a one-side isolation.

Reviewed Bradley S1 levels are 1/3/4 and S2/S3 levels 3/4. The clean small-endpoint scope comparisons above exercise level 4. Other levels appear in the residual-bearing combinations; their coefficients are not independently verified.

## Edith: separate recipient branches

Both accepted fixtures preserve **Edith 3/3/3**. The [Marksman fixture](../../../../testcases/emulator_verified/wos444_edith_s11_mark_damage_taken_hero_nc.json) has 500 defending T6 Marksmen plus Zinman 1/0/0 against 2560 Marksmen. The [Lancer fixture](../../../../testcases/emulator_verified/wos444_edith_s12_lancer_damage_dealt_hero_nc.json) has 390 defending T6 Lancers plus Patrick 3/2 and Jasser 4/4 against 2520 Infantry.

| Isolated Edith alternative | Marksman game A1863 | Lancer game A1909 |
| --- | ---: | ---: |
| Current | A1863 | A1909 |
| Omit S1 Marksman protection | A1942 | A1909 |
| Omit S1 Lancer offense | A1863 | A1978 |
| Give Marksman protection to all own types | A1863 | A1829 |
| Give Lancer offense to all own types | A1772 | A1909 |
| Omit S3 Health contribution | A1955 | A1983 |
| Restrict S3 to Infantry | A1955 | A1983 |

Each S1 branch is positively exercised in its corresponding troop type, and broadening it to the other tested type produces an appreciable error. This supports the Marksman/Lancer distinction. S3 contributes to both tested non-Infantry recipients. Infantry scope is not tested here. In particular, S2 Ironclad hydrates but has no deployed Infantry to protect; these matches provide no positive Ironclad effect evidence.

Moving S1 Marksman protection into Health gives A1876; moving its Lancer offense into Attack gives A1915. Moving S3 into damage-taken gives A1874/A1898, and moving it into Defense gives A1863/A1898. These modest scale-relative differences do not settle general pool identity. Exact coefficients/scaling, other levels, skill-kind modifiers and mode interactions remain unreviewed. No whole skill or nested effect is marked fully verified.
