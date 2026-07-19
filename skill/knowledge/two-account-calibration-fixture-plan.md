# Two-Account Calibration Fixture Plan

## Read This When

Read this when collecting fresh reports from two configured emulator accounts for a paired calibration batch.

Use generic roles in open-source docs:

- `calibration_attacker`
- `calibration_defender`

Map those roles to local instance/account names through gitignored config or task-local notes. Do not put private account nicknames in knowledge docs.

## Capture Rules

- Capture fresh stat bonuses for both accounts in the same session.
- Capture current hero skill levels before hero fixtures.
- Use current troop ids, tiers, fire-crystal levels, and counts.
- Do not add `_nc` to testcase filenames. The test runner determines whether a case is stochastic from the hydrated skills; the filename does not.
- Store individual game observations under `game_report_result`.
- Prefer paired no-hero controls with identical troop composition.
- Compare with `npx tsx scripts/run_testcases.ts`, not with `wosctl run-testcase`.

Recommended repeat counts:

| Fixture type | Repeats |
|---|---:|
| deterministic no-hero control | 1-3 |
| deterministic full-kit hero case | 3-5 |
| chance-heavy hero case | 20+ |
| high-variance chance combo | 30+ |

## Batch 0: Controls

Run controls first to detect stale stats, parser drift, troop-id mistakes, or role asymmetry.

| ID | Attacker | Defender | Repeats | Purpose |
|---|---|---|---:|---|
| `nohero_inf_role_a_current` | `calibration_attacker`, no heroes, infantry only | `calibration_defender`, no heroes, infantry only | 3 | Base single-type control. |
| `nohero_inf_role_b_current` | `calibration_defender`, no heroes, infantry only | `calibration_attacker`, no heroes, infantry only | 3 | Role-swapped control. |
| `nohero_mixed_current` | `calibration_attacker`, no heroes, mixed army | `calibration_defender`, no heroes, mixed/small army | 3 | Control for mixed hero batches. |
| `nohero_two_type_current` | `calibration_attacker`, no heroes, two troop types | `calibration_defender`, no heroes, mixed/small army | 3 | Control for gated two-type tests. |

Use exact counts from the current calibration scenario rather than stale historical counts.

## Batch 1: Greg + Mia

Goal: separate Greg-only, Mia-only, and combo/stacking behavior while treating each hero as a full current kit.

| ID | Defender heroes | Repeats | Purpose |
|---|---|---:|---|
| `greg_mia_nohero_control_current` | none | 3 | Exact paired control. |
| `greg_only_defender_current` | Greg only | 20 | Greg full-kit effect. |
| `mia_only_defender_current` | Mia only | 20 | Mia full-kit effect. |
| `greg_mia_defender_current` | Greg + Mia | 30 | Stacking and chance interaction. |
| `greg_mia_no_marksmen_body_current` | Greg + Mia, no marksmen body if feasible | 20 | Gates marksman-dependent effects. |
| `greg_mia_no_lancer_body_current` | Greg + Mia, no lancers body if feasible | 20 | Gates lancer-dependent effects. |

## Batch 2: Wayne

Goal: test attack-frequency and target gating.

| ID | Attacker | Defender | Repeats | Purpose |
|---|---|---|---:|---|
| `wayne_inf_only_current` | `calibration_attacker` + Wayne, infantry only | `calibration_defender` no heroes, infantry only | 20 | Gates off marksman-specific effects. |
| `wayne_mark_vs_infantry_current` | `calibration_attacker` + Wayne, marksmen only | `calibration_defender` no heroes, infantry only | 20 | Ineligible-target check. |
| `wayne_mark_vs_lancer_current` | `calibration_attacker` + Wayne, marksmen only | `calibration_defender` no heroes, lancers only | 20 | Eligible-target check. |
| `wayne_mark_vs_marksman_current` | `calibration_attacker` + Wayne, marksmen only | `calibration_defender` no heroes, marksmen only | 20 | Eligible-target check. |
| `wayne_mixed_current` | `calibration_attacker` + Wayne, mixed | `calibration_defender` no heroes, mixed | 30 | Full mixed behavior. |

## Batch 3: Norah

Goal: test skill-damage fanout and `trigger_damage_jobs` target behavior.

| ID | Attacker | Defender | Repeats | Purpose |
|---|---|---|---:|---|
| `norah_primary_control_current` | `calibration_attacker` no heroes | `calibration_defender` no heroes, mixed/small | 3 | Paired control. |
| `norah_primary_active_current` | `calibration_attacker` no heroes | `calibration_defender` + Norah, mixed/small | 20 | Tests whether generated skill jobs include primary target. |
| `norah_fanout_control_current` | `calibration_attacker` no heroes, composition with non-primary pressure | `calibration_defender` no heroes, gated target | 3 | Paired fanout control. |
| `norah_fanout_active_current` | same attacker | `calibration_defender` + Norah, gated target | 20 | Tests non-primary fanout. |
| `norah_solo_mixed_current` | `calibration_attacker` no heroes, mixed | `calibration_defender` + Norah, mixed | 20 | General mean/variance check. |

## Batch 4: Natalia

Goal: test damage-reduction timing and chance distribution.

| ID | Attacker | Defender | Repeats | Purpose |
|---|---|---|---:|---|
| `natalia_nohero_control_current` | `calibration_attacker` no heroes, mixed | `calibration_defender` no heroes, mixed | 3 | Exact paired control. |
| `natalia_solo_mixed_current` | `calibration_attacker` no heroes, mixed | `calibration_defender` + Natalia, mixed | 30 | Main mean/variance fixture. |
| `natalia_inf_only_control_current` | `calibration_attacker` no heroes, infantry only | `calibration_defender` no heroes, infantry only | 3 | Single-type control. |
| `natalia_inf_only_current` | `calibration_attacker` no heroes, infantry only | `calibration_defender` + Natalia, infantry only | 20 | Timing and damage-reduction fixture. |

## Batch 5: Reina + Bahiti

Goal: separate Reina-only, Bahiti-only, and combo behavior.

| ID | Defender heroes | Repeats | Purpose |
|---|---|---:|---|
| `reina_bahiti_nohero_control_current` | none | 3 | Exact paired control. |
| `reina_only_current` | Reina only | 20 | Reina full-kit contribution. |
| `bahiti_only_current` | Bahiti only | 20 | Bahiti full-kit and chance contribution. |
| `reina_bahiti_current` | Reina + Bahiti | 30 | Combo and stacking behavior. |

## Batch 6: Alonso

Goal: refresh high-variance defender cases after higher-priority clusters are understood.

| ID | Attacker | Defender | Repeats | Purpose |
|---|---|---|---:|---|
| `alonso_defender_nohero_control_current` | `calibration_attacker` no heroes, mixed | `calibration_defender` no heroes, mixed | 3 | Exact control. |
| `alonso_defender_mixed_current` | `calibration_attacker` no heroes, mixed | `calibration_defender` + Alonso, mixed | 30 | High-variance defender case. |
| `alonso_attacker_sanity_current` | `calibration_attacker` + Alonso, mixed | `calibration_defender` no heroes, mixed/small | 10 | Sanity check against already-good attacker shapes. |
