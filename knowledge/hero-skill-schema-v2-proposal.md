# Hero Skill Schema V2 Proposal

WOS-277 asks for a clearer hero skill definition shape without wiring it into
the current simulator. The proposed full catalogue is
`assets/hero_skills_v2_proposed.json`.

## Scope

This is a proposal artifact only. It is intentionally not code-compatible with
`Base_classes.Skill` and should not be loaded by runtime code until a later
migration task defines an adapter.

The proposal was derived from every file in `assets/hero_skills/`:

- 30 heroes
- 104 current skill entries
- 114 current effects
- 22 slot-4 widget skills
- 5 no-effect non-combat placeholders

After separating widgets, the proposed catalogue contains:

- 77 combat skills
- 92 combat effects
- 22 widgets
- 5 non-combat placeholders

The 92 combat effects plus 22 widget effects account for all 114 current
effects.

## Schema Shape

The proposal uses this top-level shape:

```json
{
  "schemaVersion": "hero-skill-proposal-v2.1",
  "defaults": {},
  "vocabulary": {},
  "reservedButNotUsedByCurrentHeroCatalog": {},
  "heroes": []
}
```

Each hero has:

- `hero`
- `troop`
- optional `aliases`
- `skills` for combat skills
- optional `widget` for slot-4 widget stat bonuses
- optional `nonCombatSkills` for known no-effect placeholders

Each combat skill keeps only semantic data:

- `slot`, `name`, `text`
- optional `availability`
- `effects`

Each effect keeps the shared Benefit concepts needed by tracing and residual
grouping:

- `type` and `op`
- optional `side`
- optional `damageKind`
- optional `damagePass`
- optional `event`
- optional `benefitTarget`
- optional `duration`
- optional `valuePctByLevel`
- optional `chancePctByLevel`
- optional explicit former-`special` concepts

## Availability vs Event

Review feedback correctly called out that the first draft still tangled
skill-level activation with effect-level triggering.

In this proposal, a skill does not have a trigger. A skill has
`availability`: whether the skill source is available for the battle, on a
cadence, behind a chance roll, or gated by the source troop still being alive.

An effect has an `event`: the combat event that may instantiate a Benefit from
an available skill. That distinction matters because a battle-long skill can
still contain an event-gated effect. For example, a permanent skill with default
availability can create a Benefit when an eligible troop attacks; that is an
effect event, not the skill "re-activating".

The old name `activation` was removed from the proposed catalogue because it
encouraged the wrong mental model.

## Defaults

The current files repeat many implementation defaults. V2 omits these unless a
skill or effect differs:

- hero source is `hero_skill`
- skill availability is battle-long
- a skill suppresses retriggering while a previous Benefit from the same skill
  is still active
- skills do not require their base troop type to remain alive
- skill order is `1`
- effects apply to self
- effects are normal modifiers, not extra attacks
- effects apply to both normal and extra passes
- effects trigger from all troop types against all troop types
- effects benefit the triggering troop type against any current target
- effect duration is battle-long
- effects are deterministic

## Concept Mapping

Current skill-level fields map as follows:

| Current field | V2 concept |
|---|---|
| `skill_hero` | parent hero name |
| `skill_troop_type` | hero `troop` |
| `skill_num` | skill `slot` or widget `slot` |
| `skill_name` | `name` |
| `skill_description` | `text` |
| `skill_permanent=false` + `skill_frequency` | `availability.cadence` |
| `skill_first_round` | `availability.window.firstTurn` |
| `skill_last_round` | `availability.window.lastTurn` |
| `skill_is_chance` / `skill_probability` | `availability.chancePct` |
| `skill_round_stackable=false` | `availability.retriggerPolicy: "suppress_while_active_benefit_exists"` |
| `skill_round_stackable=true` | `availability.retriggerPolicy: "allow_overlap"` |
| `skill_type_relation` | `availability.requiresSourceTroopAlive` |
| `skill_order != 1` | `availability.resolutionOrder` |

Current effect-level fields map as follows:

| Current field | V2 concept |
|---|---|
| `effect_num` | `id` |
| `effect_type` | `type` |
| `effect_op` | `op` |
| `affects_opponent=true` | `side: "opponent"` |
| `extra_attack=true` | `damageKind: "extra"` |
| `benefit_on` | `damagePass` |
| `trigger_for` / `trigger_vs` | `event` |
| `benefit_for` / `benefit_vs` | `benefitTarget` |
| `effect_duration` | `duration` |
| `effect_values` | `valuePctByLevel` |
| `effect_is_chance` / `effect_probabilities` | `chancePctByLevel` |

## Retrigger Policy vs Same-Event Limits

The original field name `skill_round_stackable` is misleading. In current
runtime behavior, `skill_round_stackable=false` does not simply mean "cannot
trigger multiple times in the same turn". It suppresses new benefit creation
while a valid Benefit from the same skill is carried over from the previous
round.

The proposal therefore uses `availability.retriggerPolicy`:

- `suppress_while_active_benefit_exists` for current
  `skill_round_stackable=false`
- `allow_overlap` for current `skill_round_stackable=true`

Same-event or same-turn repeat limiting remains an effect-event concept. Current
values such as `trigger_for=once` and the runtime-supported-but-unused
`trigger_for=first` belong under `event.by`, not under skill availability.

## Former `special` Concepts

The current hero catalogue uses `special` for four separate ideas. V2 exposes
them explicitly:

| Current `special` shape | V2 concept |
|---|---|
| `{ "pause_attack": true }` | `triggerAction: "pause_triggering_attack"` |
| `{ "effect_evolution": { "category": "effect_is_total_damage" } }` | `valueSemantics: "total_damage_pct"` |
| `{ "effect_evolution": { "category": "effect_decrease" } }` | `valueEvolution` |
| `{ "role": "...", "stat": "..." }` on slot 4 | `widget.role` and `widget.stat` |

The runtime also checks `special.hp_threshold` and `special.onDefense`, and
`trigger_for=first` is recognized by `RoundEffect`. No current hero skill file
uses those concepts, so the proposal reserves them instead of inventing
unverified hero entries.

## Expressibility Check

The proposed vocabulary covers every current hero catalogue variant:

- availability cadence: battle-long, every N turns, every N attacks, first turn,
  last turn, skill-level chance, retrigger policy, and troop-alive gating
- effect event: all, once, troop-specific event; `first` reserved for the
  runtime-supported but currently unused case
- benefit target: trigger, all, friendly, troop-specific target
- target relation: any current target, locked target, specific troop type, and
  fan-out splash (`benefit_vs=all`)
- damage pass: all, normal-only, extra-only
- effect kind: ordinary modifier, extra damage, dodge
- side: self and opponent
- duration: battle, turns, attacks, lagged duration
- value behavior: level values, level probabilities, total-damage extra values,
  geometric value decay
- widget stat bonuses: attack, defense, health, lethality across attack,
  defense, and rally roles

Because the proposed JSON keeps `type`, `op`, `id`, and current level values,
future adapter work can verify round traces against the existing
Skill -> RoundEffect -> Benefit path without collapsing mechanics into
source-specific shortcuts.
