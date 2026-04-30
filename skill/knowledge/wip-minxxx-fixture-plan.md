# WIP vs minxxx Fixture Plan

## Read this when

Read this when collecting fresh WIP/minxxx emulator reports or an equivalent two-account calibration batch.

These fixtures target residual clusters around:

- Greg + Mia stacking
- Wayne attack-frequency and target gating
- Norah splash / extra-vs-all
- Natalia damage-reduction timing
- Reina + Bahiti chance and stacking
- Alonso high-variance defender cases

Always recapture current account stats and hero skill levels before using this plan. If using different accounts, map WIP/minxxx roles through config and keep the same fixture logic.

## Capture rules

- Use fresh stats for both accounts in the same capture session.
- Record exact hero skill levels as they are on the account.
- Do not label a fixture `_nc` unless hydrated skills confirm no chance.
- Store individual game observations for stochastic cases.
- Prefer paired no-hero controls with identical troop composition.
- Record troop type, tier, fire-crystal level, and count.

Recommended repeat counts:

| Fixture type | Repeats |
|---|---:|
| deterministic no-hero control | 1-3 |
| deterministic full-kit hero case | 3-5 |
| chance-heavy hero case | 20+ |
| high-variance chance combo | 30+ |

## Batch 0: controls

Run these first to detect stale stats, parser drift, or role asymmetry.

| ID | Attacker | Defender | Repeats | Purpose |
|---|---|---|---:|---|
| `nohero_inf_role_a_current` | WIP, no heroes, infantry only | minxxx, no heroes, infantry only | 3 | Base single-type control. |
| `nohero_inf_role_b_current` | minxxx, no heroes, infantry only | WIP, no heroes, infantry only | 3 | Role-swapped control. |
| `nohero_mixed_current` | WIP, no heroes, mixed army | minxxx, no heroes, mixed/small army | 3 | Control for mixed hero batches. |
| `nohero_two_type_current` | WIP, no heroes, two troop types | minxxx, no heroes, mixed/small army | 3 | Control for Reina/Bahiti-style tests. |

Use exact counts from the current calibration scenario rather than reusing stale historical counts.

## Batch 1: Greg + Mia

Goal: separate Greg-only, Mia-only, and combo/stacking behavior while accepting that each hero is a full kit.

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
| `wayne_inf_only_current` | WIP + Wayne, infantry only | minxxx no heroes, infantry only | 20 | Gates off marksman-specific effects. |
| `wayne_mark_vs_infantry_current` | WIP + Wayne, marksmen only | minxxx no heroes, infantry only | 20 | Target where S2-style effects may be ineligible. |
| `wayne_mark_vs_lancer_current` | WIP + Wayne, marksmen only | minxxx no heroes, lancers only | 20 | Eligible target check. |
| `wayne_mark_vs_marksman_current` | WIP + Wayne, marksmen only | minxxx no heroes, marksmen only | 20 | Eligible target check. |
| `wayne_mixed_current` | WIP + Wayne, mixed | minxxx no heroes, mixed | 30 | Full mixed behavior. |

## Batch 3: Norah

Goal: test splash and extra-vs-all behavior.

| ID | Attacker | Defender | Repeats | Purpose |
|---|---|---|---:|---|
| `norah_primary_control_current` | WIP no heroes | minxxx no heroes, mixed/small | 3 | Paired control. |
| `norah_primary_active_current` | WIP no heroes | minxxx + Norah, mixed/small | 20 | Tests whether extra-vs-all hits primary target. |
| `norah_fanout_control_current` | WIP no heroes, composition with non-primary pressure | minxxx no heroes, gated target | 3 | Paired fanout control. |
| `norah_fanout_active_current` | same attacker | minxxx + Norah, gated target | 20 | Tests non-primary fanout. |
| `norah_solo_mixed_current` | WIP no heroes, mixed | minxxx + Norah, mixed | 20 | General mean/variance check. |

## Batch 4: Natalia

Goal: test damage-reduction timing and chance distribution.

| ID | Attacker | Defender | Repeats | Purpose |
|---|---|---|---:|---|
| `natalia_nohero_control_current` | WIP no heroes, mixed | minxxx no heroes, mixed | 3 | Exact paired control. |
| `natalia_solo_mixed_current` | WIP no heroes, mixed | minxxx + Natalia, mixed | 30 | Main mean/variance fixture. |
| `natalia_inf_only_control_current` | WIP no heroes, infantry only | minxxx no heroes, infantry only | 3 | Single-type control. |
| `natalia_inf_only_current` | WIP no heroes, infantry only | minxxx + Natalia, infantry only | 20 | Timing and damage-reduction fixture. |

## Batch 5: Reina + Bahiti

Goal: separate Reina-only, Bahiti-only, and combo behavior.

| ID | Defender heroes | Repeats | Purpose |
|---|---|---:|---|
| `reina_bahiti_nohero_control_current` | none | 3 | Exact paired control. |
| `reina_only_current` | Reina only | 20 | Reina full-kit contribution. |
| `bahiti_only_current` | Bahiti only | 20 | Bahiti full-kit and chance contribution. |
| `reina_bahiti_current` | Reina + Bahiti | 30 | Combo and stacking behavior. |

## Batch 6: Alonso

Goal: refresh high-variance defender cases after the higher-priority clusters are understood.

| ID | Attacker | Defender | Repeats | Purpose |
|---|---|---|---:|---|
| `alonso_defender_nohero_control_current` | WIP no heroes, mixed | minxxx no heroes, mixed | 3 | Exact control. |
| `alonso_defender_mixed_current` | WIP no heroes, mixed | minxxx + Alonso, mixed | 30 | High-variance defender case. |
| `alonso_attacker_sanity_current` | WIP + Alonso, mixed | minxxx no heroes, mixed/small | 10 | Sanity check against already-good attacker shapes. |
