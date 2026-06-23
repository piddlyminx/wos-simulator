# WOS-443 Targeted Bucket Membership Testcase Design

## Context

WOS-443 needs deterministic simulator-designed experiments for the named Edith, Gordon, and Bradley skills. The previous generic WOS-443 fixtures did not satisfy this issue and have been removed.

The method is to patch one target effect at a time into each candidate bucket and simulate a paired fight that includes deterministic reference buckets. The live emulator result should then land near one candidate row. Core physics are presumed correct; if no-hero controls fail, stop and debug stats/report parsing before interpreting bucket membership.

## Relevant files

- `scripts/wos443_bucket_membership_matrix.ts`
- `simulator/config/hero_definitions/Edith.json`
- `simulator/config/hero_definitions/Gordon.json`
- `simulator/config/hero_definitions/Bradley.json`
- `skill/data/player_hero_skills.json` or a fresh equivalent supplied with `WOS443_PLAYER_HERO_SKILLS`

## Knowledge files to read

Before running or interpreting this batch, read:

- `skill/KNOWLEDGE_INDEX.md`
- `skill/knowledge/skill-isolation-with-fixed-hero-kits.md`
- `skill/knowledge/skill-divergence-debugging.md`
- `skill/knowledge/effect-sensitivity-tracing.md`
- `skill/knowledge/testcase-dashboard-calibration.md`
- `skill/references/commands.md`

## Task

Before assigning Battle Runner, confirm which of the runnable probes below should be collected. For every selected probe, Battle Runner must first capture fresh hero skills for both accounts, then run an exact no-hero control with the same accounts, side roles, troop counts, tiers, fire-crystal levels, buffs, and report-capture path.

Generate the current simulator matrix with:

```bash
WOS443_PLAYER_HERO_SKILLS=skill/data/player_hero_skills.json npx --yes tsx scripts/wos443_bucket_membership_matrix.ts
```

The generator enforces `max_t6_per_type: 2999` while tuning each fixture, per the review request to keep any single T6 troop type under 3000.

The table below was regenerated after commit `02cd97a` updated hero-skill definitions, including Sergey.

Current captured levels used for the table below:

- minxxx: Edith 3/3/3, Gordon 2/2/0, Bradley 4/3/3
- WIP: Edith 1/0/0, Gordon 1/1/0, Bradley 4/4/4

## Expected outcomes

Outcome is signed remaining score: positive means attacker survivors, negative means defender survivors. A strong probe has a wide gap between all candidate rows.

| Target skill | Runnable now? | Troop shape | Candidate outcomes | Minimum gap | Use |
|---|---:|---|---|---:|---|
| Edith S1/1 marksman damage taken down (`StrategicBalance/1`) | yes | WIP attacks 2880 marksman; minxxx defends Edith+Sergey+Patrick with 400 marksman | `damageTaken.down` = +498; `defense.up` = +434; `health.up` = +539 | 41 | Battle Runner-ready after exact no-hero control |
| Edith S1/2 lancer damage dealt up (`StrategicBalance/2`) | yes | WIP attacks 2520 infantry; minxxx defends Edith+Patrick+Jasser with 390 lancer | `damage.up` = +916; `attack.up` = +937; `lethality.up` = +954 | 17 | Below 20-troop discriminator threshold; do not assign without a stronger design |
| Edith S2 infantry damage taken down (`Ironclad/1`) | yes | WIP attacks 2880 infantry; minxxx defends Edith+Sergey+Patrick with 900 infantry | `damageTaken.down` = -445; `defense.up` = -450; `health.up` = -440 | 5 | Not acceptable as a bucket discriminator under the troop cap |
| Gordon S1/1 lancer damage dealt up (`VenomInfusion/1`) | yes | minxxx attacks Gordon+Patrick+Jasser with 200 lancer; WIP defends 1440 infantry | `damage.up` = -512; `attack.up` = -496; `lethality.up` = -513 | 1 | Not acceptable as a bucket discriminator under the troop cap |
| Gordon S1/2 target damage dealt down (`VenomInfusion/2`) | yes | WIP attacks 2100 lancer; minxxx defends Gordon+Sergey+Lynn with 240 lancer | `damage.down` = +855; `attack.down` = +856; `lethality.down` = +849 | 1 | Not acceptable as a bucket discriminator under the troop cap |
| Gordon S2/1 lancer damage dealt up (`ChemicalTerror/1`) | yes | minxxx attacks Gordon+Patrick+Jasser with 200 lancer; WIP defends 1440 infantry | `damage.up` = -512; `attack.up` = -496; `lethality.up` = -513 | 1 | Not acceptable as a bucket discriminator under the troop cap |
| Gordon S2/2 all enemy damage dealt down (`ChemicalTerror/2`) | yes | WIP attacks 2700 each mixed; minxxx defends Gordon+Sergey+Lynn with 2560 lancer | `damage.down` = +558; `attack.down` = +593; `lethality.down` = -143 | 35 | Battle Runner-ready after exact no-hero control |
| Gordon S3/1 enemy infantry damage taken up (`ToxicRelease/1`) | no, captured S3=0 | simulator-only: minxxx attacks Gordon+Renee with 240 lancer; WIP defends 360 infantry | `damageTaken.up` = +227; `defense.down` = +227; `health.down` = +227 | 0 | Blocked: current accounts cannot check; also no live reference separates candidates |
| Gordon S3/2 enemy marksman damage dealt down (`ToxicRelease/2`) | no, captured S3=0 | simulator-only: WIP attacks 1080 marksman; minxxx defends Gordon+Sergey+Lynn with 140 lancer | `damage.down` = +75; `attack.down` = +73; `lethality.down` = +66 | 2 | Blocked by locked S3 and weak separation |
| Bradley S2/1 damage to lancer up (`PowerShot/1`) | yes | minxxx attacks Bradley+Jasser with 180 marksman; WIP defends 360 lancer | `damage.up` = +153; `attack.up` = +153; `lethality.up` = +153 | 0 | Not acceptable as a bucket discriminator under the troop cap; current config maps this effect to `active.hero.lethality.up` |
| Bradley S2/2 damage to infantry up (`PowerShot/2`) | yes | minxxx attacks Bradley+Jasser with 180 marksman; WIP defends 360 infantry | `damage.up` = +159; `attack.up` = +158; `lethality.up` = +158 | 0 | Not acceptable as a bucket discriminator under the troop cap; current config maps this effect to `active.hero.lethality.up` |
| Bradley S3 all troops damage up (`TacticalAssistance/1`) | yes | WIP attacks Bradley+Jasser with 2520 each mixed; minxxx defends 900 each mixed | `damage.up` = +1395; `attack.up` = +479; `lethality.up` = -93 | 572 | Battle Runner-ready if WIP can field attacker count |

## Non-goals

- Do not modify simulator damage formulas, bucket definitions, effect classifier policy, report parsing, OCR, template matching, gestures, or scroll behavior as part of this issue.
- Do not claim individual skill isolation from game data. These are full-current-kit fixtures.
- Do not write `sim_result` into testcase JSON. `run-testcase` collects observations only.
- Do not assign Gordon S3 probes until fresh captured skills show Gordon S3 is unlocked on an account.

## Acceptance criteria

- CEO/board confirms whether to run the three capped Battle Runner-ready probes: Edith S1/1, Gordon S2/2, and Bradley S3.
- Fresh hero skill capture exists for both instances before the batch.
- Each selected hero fixture has a same-session exact no-hero control.
- Live observed signed remaining score lands clearly closest to one candidate row and at least 20 troops away from the next candidate row.
- Any weak or unavailable probe is not assigned as if it proves bucket membership.
- Any confirmed divergence sent to Simulator Engineer includes hero, skill, candidate bucket rows, observed vs expected survivors, testcase path/control result, and a narrow hypothesis. Remind them core physics are correct.

## Validation commands

From the simulator repo root:

```bash
WOS443_PLAYER_HERO_SKILLS=skill/data/player_hero_skills.json npx --yes tsx scripts/wos443_bucket_membership_matrix.ts
```

## Risk notes

- The current capped search leaves only three probes above the 20-troop discriminator threshold. Battle Runner must not run the weak rows as bucket proof without a revised matrix.
- Gordon S1/1, Gordon S1/2, Gordon S2/1, Edith S1/2, Edith S2, and Bradley S2 are currently too weak to prove bucket membership under the per-type T6 cap.
- Gordon S3 is blocked by captured skill level 0 on both minxxx and WIP.
- The simulator matrix uses captured skill levels from `skill/data/player_hero_skills.json`. Refresh this file before final assignment if account skills changed.

## Output expectations

Before assigning Battle Runner, request confirmation on this design. After confirmation, QA should commit captured testcase JSON under `testcases/emulator_verified/` and comment with:

- Commands run and repeat counts.
- Fresh hero skill capture confirmation.
- Control survivors, hero fixture survivors, and closest candidate row.
- Any blocker, including troop shortages or missing hero availability.
