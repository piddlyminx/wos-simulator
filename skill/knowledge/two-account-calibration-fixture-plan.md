# Two-Account Calibration Fixture Plan

## Read This When

Read this when collecting fresh reports from two configured emulator accounts for a calibration batch.

Use generic roles in open-source docs:

- `calibration_attacker`
- `calibration_defender`

Map those roles to local instance/account names through gitignored config or task-local notes. Do not put private account nicknames in knowledge docs.

## Capture Rules

- Follow [Testcase Evidence Policy](testcase-evidence-policy.md) for emulator capture counts and parity acceptance.
- Capture fresh stat bonuses for both accounts in the same session.
- Capture current hero skill levels before hero fixtures.
- Use current troop ids, tiers, fire-crystal levels, and counts.
- Do not add `_nc` to testcase filenames. The test runner determines whether a case is stochastic from the hydrated skills; the filename does not.
- Store individual game observations under `game_report_result`.
- Compare with `npx tsx scripts/run_testcases.ts`, not with `wosctl run-testcase`.

## Batch 1: Greg + Mia

Goal: separate Greg-only, Mia-only, and combo/stacking behavior while treating each hero as a full current kit.

| ID | Defender heroes | Purpose |
|---|---|---|
| `greg_only_defender_current` | Greg only | Greg full-kit effect. |
| `mia_only_defender_current` | Mia only | Mia full-kit effect. |
| `greg_mia_defender_current` | Greg + Mia | Stacking and chance interaction. |
| `greg_mia_no_marksmen_body_current` | Greg + Mia, no marksmen body if feasible | Gates marksman-dependent effects. |
| `greg_mia_no_lancer_body_current` | Greg + Mia, no lancers body if feasible | Gates lancer-dependent effects. |

## Batch 2: Wayne

Goal: test attack-frequency and target gating.

| ID | Attacker | Defender | Purpose |
|---|---|---|---|
| `wayne_inf_only_current` | `calibration_attacker` + Wayne, infantry only | `calibration_defender` no heroes, infantry only | Gates off marksman-specific effects. |
| `wayne_mark_vs_infantry_current` | `calibration_attacker` + Wayne, marksmen only | `calibration_defender` no heroes, infantry only | Ineligible-target check. |
| `wayne_mark_vs_lancer_current` | `calibration_attacker` + Wayne, marksmen only | `calibration_defender` no heroes, lancers only | Eligible-target check. |
| `wayne_mark_vs_marksman_current` | `calibration_attacker` + Wayne, marksmen only | `calibration_defender` no heroes, marksmen only | Eligible-target check. |
| `wayne_mixed_current` | `calibration_attacker` + Wayne, mixed | `calibration_defender` no heroes, mixed | Full mixed behavior. |

## Batch 3: Norah

Goal: test skill-damage fanout and `trigger_damage_jobs` target behavior.

| ID | Attacker | Defender | Purpose |
|---|---|---|---|
| `norah_primary_active_current` | `calibration_attacker` no heroes | `calibration_defender` + Norah, mixed/small | Tests whether generated skill jobs include primary target. |
| `norah_fanout_active_current` | `calibration_attacker` no heroes, composition with non-primary pressure | `calibration_defender` + Norah, gated target | Tests non-primary fanout. |
| `norah_solo_mixed_current` | `calibration_attacker` no heroes, mixed | `calibration_defender` + Norah, mixed | General mean/variance check. |

## Batch 4: Natalia

Goal: test damage-reduction timing and chance distribution.

| ID | Attacker | Defender | Purpose |
|---|---|---|---|
| `natalia_solo_mixed_current` | `calibration_attacker` no heroes, mixed | `calibration_defender` + Natalia, mixed | Main mean/variance fixture. |
| `natalia_inf_only_current` | `calibration_attacker` no heroes, infantry only | `calibration_defender` + Natalia, infantry only | Timing and damage-reduction fixture. |

## Batch 5: Reina + Bahiti

Goal: separate Reina-only, Bahiti-only, and combo behavior.

| ID | Defender heroes | Purpose |
|---|---|---|
| `reina_only_current` | Reina only | Reina full-kit contribution. |
| `bahiti_only_current` | Bahiti only | Bahiti full-kit and chance contribution. |
| `reina_bahiti_current` | Reina + Bahiti | Combo and stacking behavior. |

## Batch 6: Alonso

Goal: refresh high-variance defender cases after higher-priority clusters are understood.

| ID | Attacker | Defender | Purpose |
|---|---|---|---|
| `alonso_defender_mixed_current` | `calibration_attacker` no heroes, mixed | `calibration_defender` + Alonso, mixed | High-variance defender case. |
| `alonso_attacker_sanity_current` | `calibration_attacker` + Alonso, mixed | `calibration_defender` no heroes, mixed/small | Sanity check against already-good attacker shapes. |
