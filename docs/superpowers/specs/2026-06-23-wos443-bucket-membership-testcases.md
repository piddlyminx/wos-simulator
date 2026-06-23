# WOS-443 Bucket Membership Testcase Design

## Context

WOS-443 needs targeted in-game fixtures that can prove whether hydrated hero effects belong in the intended simulator damage buckets. The goal is not to change simulator physics. Core damage physics are presumed correct unless paired no-hero controls fail.

Existing coverage already includes broad solo and combo hero fixtures plus WOS-425 WIP defender cases for Patrick, Sergey, Philly, and a no-hero control. This design adds a small WOS-443 matrix that is easier to reason about by bucket family and side.

## Relevant files

- `skill/testcase_spec/wos443_control_minxxx_attacks_wip_infantry_nc.json`
- `skill/testcase_spec/wos443_control_wip_attacks_minxxx_mixed_nc.json`
- `skill/testcase_spec/wos443_control_wip_attacks_minxxx_reina_infantry_nc.json`
- `skill/testcase_spec/wos443_attacker_jessie_lethality_defense_nc.json`
- `skill/testcase_spec/wos443_defender_sergey_defense_attackdown_nc.json`
- `skill/testcase_spec/wos443_attacker_reina_normal_damage_gate.json`
- `skill/testcase_spec/wos443_defender_wuming_pass_buckets_nc.json`
- Existing references: `testcases/emulator_verified/wos425_wip_nohero_control_nc.json`, `testcases/emulator_verified/wos425_wip_sergey_damage_taken_nc.json`, `testcases/emulator_verified/wu_ming_solo_nc.json`, `testcases/emulator_verified/reina_attacker_wip.json`

## Knowledge files to read

Before running or interpreting this batch, read:

- `skill/KNOWLEDGE_INDEX.md`
- `skill/knowledge/skill-isolation-with-fixed-hero-kits.md`
- `skill/knowledge/skill-divergence-debugging.md`
- `skill/knowledge/effect-sensitivity-tracing.md`
- `skill/knowledge/testcase-dashboard-calibration.md`
- `skill/references/commands.md`

## Task

Run the WOS-443 specs as one fresh capture batch after capturing current hero skills for both instances. Start with no-hero controls, then run deterministic hero fixtures, then run the Reina fixture with repeats if Swift Jive is unlocked.

Bucket hypotheses:

| Spec | Primary bucket membership being tested | Control |
|---|---|---|
| `wos443_attacker_jessie_lethality_defense_nc` | `active.hero.lethality.up` on owner attack jobs; secondary `active.hero.defense.up` on counter-damage jobs | `wos443_control_minxxx_attacks_wip_infantry_nc` |
| `wos443_defender_sergey_defense_attackdown_nc` | `active.hero.defense.up` as defender denominator; `active.hero.attack.down` as attacker-side denominator | `wos443_control_minxxx_attacks_wip_infantry_nc` |
| `wos443_attacker_reina_normal_damage_gate` | `type.normal.damage.up` without lancer-gated extra-skill damage | `wos443_control_wip_attacks_minxxx_reina_infantry_nc` |
| `wos443_defender_wuming_pass_buckets_nc` | `type.normal.defense.up`, `type.skill.defense.up`, `type.skill.damage.up`, and `passive.defense.up` stay in distinct pass/static buckets | `wos443_control_wip_attacks_minxxx_mixed_nc` |

## Non-goals

- Do not modify simulator damage formulas, bucket definitions, effect classifier policy, report parsing, OCR, template matching, gestures, or scroll behavior as part of this issue.
- Do not claim individual skill isolation from game data. These are full-current-kit fixtures.
- Do not write `sim_result` into testcase JSON. `run-testcase` collects observations only.

## Acceptance criteria

- Fresh hero skill capture exists for both instances before the batch.
- Each hero fixture has a same-session no-hero control with matching side roles and compatible troop scale.
- Deterministic fixtures have at least one observation whose report reached the bottom and parsed non-zero stats.
- Stochastic fixtures preserve individual observations and have at least 8 observations unless fresh captured skills prove chance/dodge effects are locked.
- Simulator comparison is run after capture and reviewed by bucket family, not only by filename.
- Any confirmed divergence sent to Simulator Engineer includes hero, skill, expected bucket, observed vs expected survivors, testcase path, paired control result, and a narrow hypothesis. Remind them core physics are correct.

## Validation commands

From the simulator repo root:

```bash
jq empty skill/testcase_spec/wos443_*.json
./skill/scripts/wosctl --instance WIP capture-hero-skills
./skill/scripts/wosctl --instance minxxx capture-hero-skills
./skill/scripts/wosctl --instance minxxx run-testcase skill/testcase_spec/wos443_control_minxxx_attacks_wip_infantry_nc.json
./skill/scripts/wosctl --instance minxxx run-testcase skill/testcase_spec/wos443_attacker_jessie_lethality_defense_nc.json
./skill/scripts/wosctl --instance minxxx run-testcase skill/testcase_spec/wos443_defender_sergey_defense_attackdown_nc.json
./skill/scripts/wosctl --instance WIP run-testcase skill/testcase_spec/wos443_control_wip_attacks_minxxx_mixed_nc.json
./skill/scripts/wosctl --instance WIP run-testcase skill/testcase_spec/wos443_defender_wuming_pass_buckets_nc.json
./skill/scripts/wosctl --instance WIP run-testcase skill/testcase_spec/wos443_control_wip_attacks_minxxx_reina_infantry_nc.json
./skill/scripts/wosctl --instance WIP run-testcase skill/testcase_spec/wos443_attacker_reina_normal_damage_gate.json --repeat 8
npx tsx scripts/run_testcases.ts --matching wos443_
```

## Risk notes

- This worktree does not contain `skill/data/player_hero_skills.json`, so current availability and skill levels must be captured by QA before execution.
- Some fixtures may be too one-sided after current account growth. If a battle ends before the bucket has meaningful exposure, keep the side roles and hero kit fixed and adjust only troop counts, then re-run the exact paired control in the same batch.
- The Wu Ming fixture intentionally mixes pass-specific buckets. If it diverges, use trace or sensitivity runs to separate `type.normal.*`, `type.skill.*`, and `passive.defense.up`; do not change all pass buckets together.

## Output expectations

QA should commit captured testcase JSON under `testcases/emulator_verified/` and comment with:

- Commands run and repeat counts.
- Fresh hero skill capture confirmation.
- Control survivors and hero fixture survivors.
- Simulator comparison command and bucket-family residual summary.
- Any blocker, including troop shortages or missing hero availability.
