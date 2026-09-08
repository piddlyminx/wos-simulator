# Outer army-term ceiling review — 2026-09-07

Removing only the outer ceiling survives this broad retrospective disconfirmation attempt and improves many independent kinds of fixture. It does not make the entire simulator agree with the game. Several existing Gatot and Gwen disagreements worsen; those remain counterevidence requiring investigation. Production was not changed.

The isolated alternative is:

```text
dealerTroops = ceilIgnoringFloatResidue(positive round-start source troops)
current:   armyTerm = ceilIgnoringFloatResidue(sqrt(dealerTroops) * sqrt(minInitialArmy))
candidate: armyTerm = sqrt(dealerTroops) * sqrt(minInitialArmy)
```

The inner source ceiling, fractional casualty state, target eligibility, source protection basis, damage factors, skill configurations and final survivor rounding are unchanged. The frozen compiled config hash is `bcb0d3068845ca143802c6e59cd7a530a8440606133b770613c418bed425b17c`. All source/config files in the preserved baseline manifest matched current files, and the isolated runtime was checked to differ by exactly this one line.

The snapshot covers all **291 active fixtures** available at `2026-09-07T04:42:50Z`, plus the separately archived old Wu battle: 173 deterministic and 119 stochastic rows. All 156 `emulator_verified` rows are accepted in-game evidence by user instruction. Other corpus rows are retained as additional constraints with their existing provenance; the historical Gatot evidence is not discarded because it lives elsewhere. Counts describe fixture rows, not necessarily independent experiments. Existing outcomes were known before this analysis, and the candidate was selected after examining six no-hero mixed cases.

## Deterministic results

Exact stored inputs are used without stat adjustment. Errors compare every stored observation with the raw prediction; the practical threshold is two troops. [Separate side checks](deterministic-details.json) also compare attacker and defender totals independently, including 1500-round Gatot draws, so signed-score cancellation cannot hide a failure.

| Scope | Improved | Worsened | Unchanged | Outside two troops: before → after |
| --- | ---: | ---: | ---: | ---: |
| 172 active deterministic rows | 84 | 11 | 77 | 50 → 23 |
| 84 accepted emulator deterministic rows | 33 | 3 | 48 | 12 → 6 |
| Archived earlier Wu capture | 1 | 0 | 0 | 1 → 0 |

**No previously within-two row moves outside two**, by either signed score or separate survivor totals. The six selected no-hero mixed cases all finish within one; broader gains include single-line no-hero, troop-count precision, Jessie, Patrick, Norah, Gordon, and some Gatot fixtures.

Strong independent checks:

- Archived Wu: game defender 200; current 219; candidate **200**. The newer Wu fixture stays exactly 223, and its rounding follow-up improves from 179 to observed 180.
- `damage_precision_325l_009i_325m`: game defender 253; current 242; candidate **253**.
- `retarget_lancer_screen_nc`: game and both models defender **303**.
- `army_term_precision_002i_003l`: game and both models defender **3**. Its original forecast rejected accidental floating-point ceiling inflation, which predicted 2. It does not select outer ceiling over the fractional alternative. Current/candidate simulated rounds are 52/63; no observed round count is stored.

Material remaining counterexamples include:

| Fixture | Game | Current | Candidate | Error change |
| --- | ---: | ---: | ---: | ---: |
| Gatot S1, 5050 vs 1000: defender at round cap; attacker stays 5047 | 74 | 66 | 88 | 8 → 14 |
| Gatot health ×1.1, 5100 vs 1000: defender at round cap; attacker stays 5097 | 80 | 77 | 90 | 3 → 10 |
| Gatot/Bradley S10, defender survivors | 2296 | 2279 | 2274 | 17 → 22 |
| Old `gwen_solo_nc`, attacker survivors | 3006 | 3009 | 3011 | 3 → 5 |

The old Gwen kit is **1/1/0**, so a Blastmaster correction cannot explain that residual. The two fresh Blastmaster discrepancies remain 9 troops and 29 troops under this isolated arithmetic alternative; the latter worsens by one. The only other accepted emulator worsening is a Bradley control moving from exact to one troop away. [Full results](results.json) retain every worsening and remaining disagreement, including the unresolved 423-troop Gatot S3 residual.

## Stochastic results and limits

All 119 stochastic rows were screened with 256 candidate samples using the preserved baseline seed construction. Baseline raw samples were reused, and paired differences compare the same seed prefix. There were no new failures at the existing raw combined CDF/support threshold `p < 1/250`.

A rule frozen before further sampling selected **nine** low-p or substantially deteriorated screens for **10,000 samples under each model**, with the same inputs and seeds. [Confirmation results](confirmation.json) again show no new failures. Existing failures remain for mixed-heroes row #2 (`0.001 → 0.0018`), Hector/Renee/Wayne (`0.00235 → 0.00375`), and Gatot S8 25000 (`0.0023 → 0.00285`). S8 11548 improves from `0.00115` to `0.005`, which is marginal agreement under this test, not proof of matching distributions. Alonso v2's deterioration remains plausible (`0.505075 → 0.285036`). The other 110 rows retain the preliminary 256-sample screen; those screens cannot establish complete distribution equality or exclude every tail disagreement.

## Origin and reproduction

The outer ceiling predates the present engine. The initial Python import `59d6b222` contains `math.ceil(army)` in `Base_classes/BattleRound.py:293`; the first operational v3 slice `87d447b2` contains the same outer ceiling in `v3/src/damage.ts:53`. The original mixed no-hero fixtures arrived with that initial import. Later commits made this ceiling residue-safe; the inner positive-source ceiling was added separately in `21d98c4b`. The [current rewrite specification](../../../../simulator/battle-core-rewrite-spec.md:842) describes the existing formula as “currently equivalent.” This bounded history search found no isolated in-game observation establishing the outer ceiling specifically.

[Summary JSON](summary.json) includes source/artifact hashes and counts. Run from repository root:

```sh
python3 docs/mechanics-audit/reviews/outer-army-ceil/prepare-runtime.py
simulator/node_modules/.bin/tsx docs/mechanics-audit/reviews/outer-army-ceil/audit.mts
simulator/node_modules/.bin/tsx docs/mechanics-audit/reviews/outer-army-ceil/deterministic-details.mts
simulator/node_modules/.bin/tsx docs/mechanics-audit/reviews/outer-army-ceil/confirm.mts
```

The preparation script validates the frozen source hashes and recreates the isolated runtime only if absent. It does not rewrite an existing shared copy. A changed production config requires a separately named audit rather than overwriting this config snapshot. Prospective probes using this alternative must keep it separate from their frozen current-engine forecasts.
