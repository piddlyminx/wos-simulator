# Gatot and Renee evidence review — 2026-09-07

This bounded retrospective review supports Gatot's shield against skill damage, RoyalLegion scope beyond enemy Infantry, and Renee S1's normal damage/Lancer gate/delayed delivery in tested contexts. Renee S2/S3 have distinct source scopes. GoldenGuard has contribution evidence without a strong exclusive-scope discriminator. Existing Gatot threshold, bilateral-kit and archived Renee contradictions remain explicit; no production fix was inferred or applied.

- [Gatot findings](gatot-notes.md) preserve exact capped-battle sides/rounds, the strong Wayne shield discriminator, and remaining deterministic/stochastic contradictions.
- [Renee findings](renee-notes.md) distinguish component contribution, actual damage-kind interactions, source scope, weaker eligibility evidence and archived contradictions.
- [Protocol](protocol.json), [frozen inputs](cases.json), [provenance check](provenance-check.json) and [archive manifest](archive-manifest.json) preserve the selected alternatives and source hashes.
- [Complete comparisons](comparisons.tsv) and [validation summary](summary.json) retain every candidate/entry and all current deterministic residuals. Each `Skill-initial.json` links its full compact `Skill-initial-samples.json`.

The replay covers **88 distinct input entries and102 recorded outcome records**:72 active entries plus15 recovered stash entries and one standalone recorded Renee/Gwen input. No duplicate resolved battle inputs were found, but report IDs/timestamps are generally unavailable. These are not102 verified independent battles. Each source entry stays a separate statistical comparison, with no cross-file pooling. Existing repeated records and conflicting Ambusher trial2 metadata remain unchanged. Two accepted Gatot observations and one older Renee/Gwen endpoint lack established complete inputs in this review and are documented separately rather than reconstructed.

**157,115 simulator rows** are preserved, including10,069 rows with both armies surviving. Each row contains A,D,rounds, both three-class survivor vectors and explicit winner code (`draw=0`, `attacker=1`, `defender=-1`). All scores are A−D, including draws. Chance classification comes from hydrated effects:59 current entries are deterministic and29 stochastic. Some stochastic entries have zero sampled spread; that does not make their hydrated mechanics deterministic.

Gatot candidates use500 samples per stochastic entry; Renee uses1000. Deterministic candidates run once. Seed strings are `gatot-renee-review-2026-09-07:<fixture-key>:<run-index>`. The first16 runs preserve separate modifier application and generated-job counts; those are simulator traces, not new game observations. All sample hashes, vector sums, means/SDs, winners, deterministic residuals and duplicate current runs were validated. Every frozen source hash matched before and after execution and summary extraction.

No coefficients/probabilities, recorded stats, troop/FC keys, hero kits or source/casualty rounding rules changed. The established sequential conserved shield pool remains intact. Counterfactuals remove only the selected component or change one declared scope/kind/delivery field; all other full-kit behavior stays current. Bilateral Gatot fixtures change both owners' selected skill. Common seed strings are reproducible but do not guarantee paired proc sequences after structural changes.

Three current stochastic entries have raw combined CDF/support p<1/250: Gatot S8-11548, S8-25000, and archived high-level Renee/Hendrik. These are unresolved compatibility diagnostics, not automatic proof of a bug. Raw deterministic errors above2 remain numeric diagnostics; sub1000-army1–2 aims and sensible flexibility at larger scales follow the agreed evidence policy. Practical agreement of a full kit does not certify every constituent dimension.

From the repository root, reproduce a skill using a new output suffix:

```sh
simulator/node_modules/.bin/tsx docs/mechanics-audit/reviews/gatot-renee-2026-09-07/worker.mts KingsBestowal replay
python docs/mechanics-audit/reviews/gatot-renee-2026-09-07/summarize.py
```

Other IDs are GoldenGuard, RoyalLegion, NightmareTrace, Dreamcatcher and Dreamslice. The optional fourth CLI argument overrides simulation repetitions for a separately named followup. Existing outputs cannot be overwritten. Frozen artifacts and source hashes are checked; replay refuses drift rather than silently refreshing the prediction model. `freeze.mts` records preparation, while the preserved archive bytes make replay independent of moving stash indices. No live emulator actions or working testcase restoration were performed.
