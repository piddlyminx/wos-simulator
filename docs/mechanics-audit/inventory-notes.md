# Mechanics evidence inventory

Generated 2026-09-08T03:54:57.515Z.

Current definitions: **39 heroes, 140 hero skills and 12 troop skills** (176 effect definitions). 5 empty definitions are retained separately and excluded from the battle-mechanic gap count. Their intended noncombat scope remains subject to review.

The active corpus has **301 entries in 224 files and 622 stored outcome records**. Of 147 nonempty battle skills, 90 hydrate in at least one fixture; **57 never hydrate**. Fixture presence is separate from reviewed support. 90 skill annotations are loaded from `docs/mechanics-audit/reviewed-evidence.json`; 5 require review after definition changes. Unannotated dimensions remain unreviewed.

Paul excludes **31 skill_4 widgets** from this audit as separately validated; see the [scope clarification](README.md). Of **116 nonempty skills in scope**, **26 lack fixture hydration** and **5 hydrated skills lack a current contextual review**. Reviewed does not mean every mechanic is supported or every disagreement resolved. Widget rows remain inventoried with an explicit exclusion reason.

Reachable new gaps from the allowed-account skill cache: none identified. This generator resolves canonical hero identities from the cache and cannot certify its live provenance. Cache source: `skill/data/player_hero_skills.json`. Preserve the full actual hero kit when designing probes.

0 active fixture entries supply an engagement type; 0 contain joiner heroes. 31 of 31 hero definitions with engagement gates have no active fixture hydration. Inactive solo fixtures do not support a gated skill's active behavior. Config definitions explicitly marked `status: tbd`: hero:Reina:SwiftJive.

## Accepted evidence and supporting artifacts

All recorded game outcomes are accepted evidence by Paul's instruction on 2026-09-07, regardless of folder, unless explicitly flagged invalid or obsolete: **301 active entries**. Missing images, age, or a simulator mismatch do not invalidate an observation. Review concerns which mechanics each battle exercises and whether predictions agree. For new captures, preserve images when available.

Agreement is judged at the battle's scale: one or two survivors is a reasonable aim for the sub-1,000 armies usually tested; the shared README also gives0.1% of combined initial troops as an accuracy aim and investigation diagnostic, not a universal hard failure. Paul considers30,449 versus30,454 effectively equal on a roughly30,000 scale. Preserve the winner and raw differences; no percentage PASS or absolute threshold replaces contextual judgment. Stochastic evidence concerns plausible outcome distributions.

8 active fixture entries directly reference an optional supporting artifact. 12 fixtures retain observed Battle Details in metadata; 66 contain historical simulator diagnostics, which are not game observations. Accepting a battle as evidence does not automatically establish every causal explanation in its description.

There are 19 duplicated test-ID groups (25 excess entries), and 3 groups with exactly repeated input/outcome records. Repeated records are flagged, never deduplicated: identical outcomes may arise from separate battles. Stored records must not be reported as independent battles. Join parity by `path#index`; IDs alone are ambiguous. 9 disabled/stale entries are listed separately, never counted as active coverage.

Hydration uses the current `adaptTestcaseEntry` and `resolveFighter` directly, including tier/FC and engagement gates. 0 active entries have resolver diagnostics. Hydration does not show that a trigger fired, that its required troop line remained alive, that an effect changed the endpoint, or that alternatives were distinguishable. Numeric config arrays define the listed level range; this is not an independently verified in-game maximum. Nested `trigger_effects` are included recursively in each skill's effect IDs and unreviewed dimensions.

## Ordinary hero skills with no active fixture

| Hero | Skills |
|---|---|
| Blanchette | S1 ArmedToTheTeeth, S2 BloodHunter, S3 CrimsonSniper |
| Fred | S1 HydraulicSuppression, S2 Acidification, S3 Floodbringer |
| Freya | S1 FogOfWar, S2 BloodMoonScythe, S3 NightsVengeance |
| Greg | S3 LawAndOrder |
| Gregory | S1 LegionOfTheSun, S2 ChargedAssault, S3 Unbroken |
| Jeronimo | S1 BattleManifesto, S2 Swordmentor, S3 EXpertSwordsmanship |
| Magnus | S1 Rapacious, S2 IronPhalanx, S3 Iceman |
| Natalia | S3 CallOfTheWild |
| Sonya | S3 TorrentialImpact |
| Xura | S1 FungalFog, S2 PiercingArrow, S3 Unorthodoxy |

31 engagement-gated definitions lack active fixture hydration in the full [skill list](skills.csv); skill_4 widgets are excluded from this audit. Empty definitions: Jasser S2 NonCombatPlaceholder, Ling S2 NonCombatPlaceholder, Lumak S2 NonCombatPlaceholder, Seo-yoon S2 NonCombatPlaceholder, Zinman S2 Bastionist.

## Troop skill applicability

| Skill | Fixtures | Stored records | Hydrated levels | Missing levels |
|---|---:|---:|---|---|
| MasterBrawler | 275 | 594 | 1 | none |
| BandsOfSteel | 14 | 35 | 1 | none |
| CrystalShield | 24 | 36 | 2 | 1 |
| BodyOfLight | 23 | 23 | 1, 2 | none |
| Charge | 212 | 510 | 1 | none |
| Ambusher | 13 | 34 | 1 | none |
| CrystalLance | 6 | 6 | 2 | 1 |
| IncandescentField | 6 | 6 | 2 | 1 |
| RangedStrike | 225 | 517 | 1 | none |
| Volley | 17 | 29 | 1 | none |
| CrystalGunpowder | 0 | 0 | none | 1, 2, 3, 4 |
| FlameCharge | 0 | 0 | none | 1, 2 |

## Files and rerun

- [inventory.json](inventory.json): every raw definition with SHA256, effect IDs, unreviewed dimensions, fixture key links, fixture metadata, disabled entries and duplicate groups.
- [skills.csv](skills.csv): one compact row per defined skill.
- [reviewed-evidence.json](reviewed-evidence.json): optional manual annotations keyed by the full skill key, with source SHA256, evidence-note paths, contextual supported dimensions, unresolved dimensions and review status. The generator validates references and preserves this file; it never infers support from fixture presence.
- [audit_mechanics.ts](../../scripts/audit_mechanics.ts): reproducible read-only audit generator; writes only its output directory.

Run from repository root: `simulator/node_modules/.bin/tsx scripts/audit_mechanics.ts`. An optional first argument selects a different output directory. Existing manual README/ledger files are not overwritten.
