# Hero definition configuration guide

This directory contains the simulator's hero catalogue. Each JSON file describes one hero, the hero's skill ordering, when each skill triggers, and the effects produced by that trigger.

This guide describes the native TypeScript simulator's current behaviour. It is not a transcription of the in-game skill text: the JSON controls the simulation, even when a `description` says something slightly different.

## Quick example

```json
{
  "name": "Example Hero",
  "aliases": ["Example"],
  "hero_generation": "S8",
  "troop_type": "lancer",
  "skills": {
    "RepeatedStrike": {
      "description": "Every second Lancer attack deals 25% extra skill damage.",
      "trigger": {
        "type": "attack",
        "every": 2,
        "source": "lancer"
      },
      "effects": {
        "RepeatedStrike/1": {
          "type": "extra_skill_attack",
          "value": [5, 10, 15, 20, 25],
          "units": {
            "applies_to": "trigger.source",
            "applies_vs": "trigger.target"
          },
          "duration": {
            "attacks": { "count": 1 }
          },
          "trigger_damage_jobs": [
            { "source": "use.source", "target": "use.target" }
          ]
        }
      }
    }
  }
}
```

At skill level 5, this trigger is attempted when the owning side's Lancer declares a normal attack whose `previous counter -> previous counter + 1` step crosses an even threshold. The counter is per side and unit type, and is shared by normal and skill-damage jobs. If nothing else has advanced it, the first activation is on the Lancer's second normal attack. It creates a one-use extra-attack effect, which immediately creates a skill-damage job from that Lancer to the normal attack's target at a `25 / 100 = 0.25` damage multiplier.

That generated skill job also increments the Lancer's counter when the round commits. Assuming the target remains valid and one extra job runs each time, this example therefore activates on the Lancer's 2nd, 3rd, 4th, ... normal attacks—not its 2nd, 4th, 6th, ... normal attacks.

The generated job does not evaluate `attack` triggers itself. If one or more generated jobs move the counter across a threshold, that threshold produces no activation and is not replayed later. A later normal attack fires only if its own `previous -> previous + 1` check crosses a threshold. Consequently, changing the number of jobs produced by an effect can change the future trigger cadence.

## File and hero fields

| Field | Accepted value | Meaning |
| --- | --- | --- |
| `name` | String | Name stored on the resolved hero and accepted when resolving battle input. It does not have to equal the filename. |
| `aliases` | Array of strings | Additional names accepted in battle input. Matching lowercases the name and removes every non-ASCII-alphanumeric character. Aliases, filenames, and `name` values must not collide after that normalization. |
| `hero_generation` | Key from `../hero_generation_stats.json` | Associates the hero with a generation stat block, such as `SR`, `S1`, `S1_natalia`, ..., `S8`. Different consumers apply that association differently; see below. |
| `troop_type` | `infantry`, `lancer`, or `marksman` | Hero class used by the dashboard catalogue and ingestion tools. It does **not** restrict which troops the hero's effects can affect, and the simulator's combat resolver does not otherwise read it. |
| `skills` | Object keyed by skill ID | The hero's skills, in skill-number order. The object key is the skill ID used in reports and may also be used when supplying a level. |

### Filename, `name`, aliases, and registration

The filename without `.json` is the definition's primary config key. The filename, `name`, and every entry in `aliases` can all resolve the hero after normalization. For example, `WuMing.json` can have `"name": "Wu Ming"`; both resolve to the same definition.

The Node directory loader discovers JSON files automatically. The browser-safe/default config in `simulator/src/config.ts` uses explicit JSON imports, so adding a new file also requires importing it and adding it to `DEFAULT_HERO_DEFINITIONS`.

### `hero_generation` is opt-in build-time data

`hero_generation` is data, not an unconditional core-simulator effect. The core combat resolver copies the string into resolved output but does not add the associated stats by itself.

For callers constructing a raw `BattleInput`, generation stats are added only when they explicitly use `applyHeroGenerationStats(...)` or `BattleInputBuilder.addHeroGenerationStats()`. Tournament input builders do this. The dashboard also reads `hero_generation` directly when adding or subtracting hero base stats in its form state, so dashboard inputs can already contain those stats before reaching the core simulator.

When enabled:

- the stat block from `hero_generation_stats.json` is added to every troop type's player stats;
- generation stats from all **main** heroes are summed;
- joiner heroes do not contribute generation stats;
- skill level does not change the generation stat block.

A `hero_generation` value with no matching entry in `hero_generation_stats.json` is reported in `config.diagnostics.unsupportedEffects` as `missing_hero_generation`. Config loading still succeeds; helpers that look up the missing block add zeroes.

## Skill fields

Each property inside `skills` is a skill definition. Its object key is significant: it becomes the resolved skill ID and is used in traces and skill reports.

| Field | Accepted value | Meaning |
| --- | --- | --- |
| `description` | String | Human-readable documentation only. Combat code does not parse or enforce it. |
| `requirements` | Array of requirement objects | Optional gates checked before the skill is added to the battle. Hero definitions currently support meaningful `engagement_type` gating; details are below. |
| `trigger` | Trigger object | Required. Determines when and for which attack/round the whole skill is attempted. |
| `effects` | Object keyed by effect ID | Effects activated together after the trigger's probability gate succeeds. An empty object is allowed for non-combat placeholder skills. |
| `status` | Free-form string | Metadata only; currently used for Reina's `"tbd"` marker. Ignored by combat code. |
| `notes` | Free-form string | Metadata only. Ignored by combat code. |

### Skill numbering and levels

Skill order is `Object.entries(...)` order. For the current descriptive, non-integer skill IDs, this is the order written in the JSON file. Battle input such as `"skill_1": 5` selects the first skill in that order, `skill_2` the second, and so on. A level may instead be supplied under the exact skill ID. `skill_N` takes precedence if both are present.

Avoid integer-like skill IDs such as `"1"` and `"10"`: JavaScript enumerates integer-index object keys numerically before other keys, regardless of their textual position in the JSON. Current hero skill IDs do not have this problem.

A missing level or a numeric level `<= 0` disables that skill. Positive levels enable it. Use positive integers: battle-input levels are coerced with `Number(...)` but are not fully validated, and fractional or non-numeric levels can enable a skill while resolving its level-dependent values incorrectly.

Most level-scaled arrays contain five entries, but selection is generic: level 1 selects index 0, and integer levels outside a non-empty array are clamped to its first or last entry. An all-string `value` array is the special fixed-order form used by `attack_order`; it is not level-selected.

Changing skill order is therefore a data migration, not cosmetic JSON reformatting.

## Requirements

A requirement has this shape:

```json
{ "level": 1, "type": "engagement_type", "value": "rally" }
```

| Field | Meaning |
| --- | --- |
| `level` | The first skill level at which this requirement applies. Below this level, the requirement is ignored. |
| `type` | For hero definitions, the only type with gating behaviour is `engagement_type`. `tier`, `fc`, and unknown types pass automatically in the hero resolver; `tier` and `fc` are meaningful only for troop skills. |
| `value` | Required engagement name. It is trimmed and lowercased before comparison. Current hero files use `rally` and `garrison`, but any non-empty string can match the same normalized `BattleInput.engagement_type`, subject to the rally special case below. |

Engagement behaviour has one deliberate rally-role special case:

- in a battle with `engagement_type: "rally"`, a `rally` requirement passes only for the attacker and a `garrison` requirement passes only for the defender;
- in a battle explicitly labelled `garrison`, a `garrison` requirement passes for either side because only `rally` receives side-specific treatment;
- any other requirement value passes for either side when it equals the normalized battle engagement;
- with no matching `engagement_type`, the skill is omitted entirely, including from the skill report.

All requirements on a skill must pass.

## Triggers

A trigger controls **when the skill is attempted**. If it matches, the simulator reaches the attempt, rolls `probability`, and proceeds only on success. Full trace mode records matching attempts, including failed probability rolls; standard mode records successful skill activations but does not retain failed-attempt counts.

### `trigger.type`

| Value | Behaviour |
| --- | --- |
| `battle_start` | Is attempted once during battle setup, before round 1. `first`, `every`, `source`, and `target` do not gate this trigger type. |
| `turn` | Is attempted at the start of matching simulator rounds. The simulator calls these rounds internally; JSON and game text commonly call them turns. Omitting `source` makes it global; defining `source` selects the separate per-unit path described below. |
| `attack` | Is attempted when a matching **normal** attack is declared. Generated skill jobs do not evaluate it. Every intended normal attack's skill triggers are processed before any controls or damage jobs for the round. |

Only these three exact strings are scheduled by the runtime. An unknown string is not rejected by a closed trigger schema; it simply leaves the skill unscheduled.

**Phase gotcha for `attack`.** The simulator first resolves every side/unit's intended normal attack for the round, then activates all matching `attack` skills for all of those intents, and only afterwards evaluates controls and damage in intent order. An effect triggered by a later intent can therefore affect an earlier intent's damage in the same round. Conversely, an `attack_order` activated by an attack trigger is too late to change targets already selected for that round.

### `trigger.probability`

Accepts either a percentage number or a per-level array of percentages:

```json
"probability": [20, 20, 20, 20, 20]
```

Omitting it means 100%. A scalar is coerced with `Number(...)`; an array selects by skill level first. The resolved value is clamped to 0–100, and a value that cannot become a finite number resolves to 0. The probability gate is attached to the whole skill trigger, not to individual effects.

An `attack` trigger rolls separately for each matching normal intent. A global `turn` trigger rolls once for the round. A per-unit `turn` trigger also rolls only once; on success, the runtime then tries to activate the effects once for each living matching source unit type. It does not roll independently for infantry, lancer, and marksman.

On the per-unit turn path, the recorder counts the probability success as a skill activation before source/target intent construction finishes. A skill can therefore report one successful activation but zero effect activations when no living source/acceptable target produces a valid synthetic intent.

Passive (`passive.*`) battle-start effects may not use probability: static passive factors must be deterministic.

### `trigger.every` and `trigger.first`

`every` defines arithmetic thresholds. What is checked against those thresholds depends on the trigger type.

- for a `turn` trigger, `"every": 4` fires on rounds 4, 8, 12, ...;
- for an `attack` trigger, `"every": 4` fires when a matching normal attack's `previous counter -> previous counter + 1` step crosses thresholds 4, 8, 12, ...; these need not be the unit's 4th, 8th, and 12th **normal** attacks;
- `"first": 4, "every": 5` uses thresholds 4, 9, 14, ... on the applicable round number or attack counter;
- omitting `every` means every otherwise-matching turn or attack;
- `first` is only valid when `every` is also present and must be at least 1.

Use positive integer intervals. The loader validates `first` but currently does not fully validate `every`, so malformed `every` values should not be treated as supported merely because they pass loading.

**Gotcha — counter updates and trigger evaluation are different events.** A normal declaration evaluates `attack` triggers using `previousAttackCount` and `projectedAttackCount = previousAttackCount + 1`. At the end of the round, the counter is advanced once for every normal damage job, cancelled normal attack, and generated skill-damage job that actually ran. Generated jobs update the counter but never evaluate `attack` triggers. Thresholds reached or crossed by those jobs are therefore skipped, not queued.

An intended normal attack is not guaranteed to advance the counter. All intents and their `attack` triggers are created from round-start troop counts, but before each intent is calculated the simulator checks whether its selected target has already been exhausted by earlier same-round jobs. If so, that intent is dropped: its trigger has already been attempted, but it produces no job or cancellation record and advances neither attack nor received-attack counters. This can leave the same frequency threshold available to the unit's next normal declaration.

Concrete current examples:

- Sonya's `BountyTemptation` emits one skill job when its every-2 trigger succeeds. With a valid target, its Lancer counter advances by two on each successful round, so the skill fires on normal attacks 2, 3, 4, ... after the first activation.
- Wayne's `RoundaboutHit` can emit two jobs, one against Lancers and one against Marksmen. When both targets exist, the Marksman counter advances by three on a successful round. Its every-2 trigger then fires on normal attacks 2, 4, 6, ... because the generated jobs themselves pass alternate thresholds without evaluating the trigger.

### `trigger.source` and `trigger.target`

These fields filter the attack shape that can trigger the skill.

- `source` means the attacking/dealing troop line. Omitted means `self.any`.
- `target` means the attacked/taking troop line. Omitted means `enemy.any`.

Supported selector forms are:

| Form | Example | Meaning |
| --- | --- | --- |
| Unqualified unit | `"lancer"` | That unit on the field's default relation: self for `source`, enemy for `target`. |
| Unit array | `["infantry", "marksman"]` | Any listed unit on the default relation. |
| Relation only | `"self"`, `"enemy"` | All unit types on that relation. |
| Relation plus all | `"self.any"`, `"self.all"`, `"enemy.any"`, `"enemy.all"` | All unit types on that relation. `any` and `all` are equivalent here. |
| Relation plus unit | `"self.lancer"`, `"enemy.infantry"` | One unit type on the selected relation. |
| Unqualified all | `"any"`, `"all"` | All units on the default relation. |

Canonical unit names are `infantry`, `lancer`, and `marksman`. The unit normalizer also recognizes common forms such as `inf`, `lancers`, `marksmen`, and `marks`, but canonical names make definitions clearer.

There is no closed selector validator here. Empty arrays resolve to an empty unit mask, and malformed unit strings generally fail later when triggers are compiled. The parser also treats `friendly` as “all units on this field's default relation”; for `target`, that default is the enemy, so `friendly` is particularly misleading and should not be used.

For an `attack` trigger, `source` and `target` are matched directly against each intended normal attack. Reina demonstrates the reverse-side form: `source: "enemy.any"` and `target: "self.any"` listens for an enemy attack against Reina's side.

For a `turn` trigger:

- with no `source`, the skill is global and activates once on each matching round; because no attack-shaped intent is constructed, `trigger.target` does not filter this path either;
- with `source`, it is per-unit: after the single probability roll succeeds, the simulator considers each living matching source troop type and builds a synthetic attack-shaped intent for it;
- source and target should resolve to opposing sides. A same-side source/target pairing cannot match the synthetic attack intent.

**Per-unit target-selection gotcha.** The runtime does not search for a troop satisfying `trigger.target`. It first chooses one opposing target using the current `attack_order` or the default order `infantry`, `lancer`, `marksman`, then checks that chosen target against the trigger selector. If the chosen target fails the selector, that source produces no effects; the runtime does not try the next living target. Thus `target: "enemy.lancer"` can produce no effect while enemy Infantry is alive, even when enemy Lancers are also alive.

`battle_start` never has an attack-shaped intent. Its `source` and `target` fields are compiled but never used for matching; use effect scopes, not trigger selectors, to scope a battle-start effect.

## Effects

For `battle_start`, global `turn`, and `attack` triggers, every entry in `effects` is activated together when the trigger's probability gate succeeds. For a per-unit `turn` trigger, every entry is activated once for each source unit type that produces a valid synthetic source/target intent; a successful probability roll alone does not guarantee an effect activation.

The entry's object key becomes the effect ID used in traces, applied-effect summaries, and extra-skill job attribution. Keep effect IDs unique across the catalogue: aggregate fields such as `extraSkillAttackJobsByEffect` are keyed by this ID alone. The current `SkillId/number` convention does that while keeping the source readable. The ID labels the effect but does not decide stacking identity; `same_effect_stacking` groups by the originating definition object and resolved scope.

Effect entries retain object enumeration order. That order is mechanically significant in some special-effect paths: extra-attack effects and their job definitions run sequentially, the first ready `attack_order` wins, and the last matching control of a given type is reported as the winner. Use descriptive non-integer IDs and treat reordering effects or `trigger_damage_jobs` as a behavioural change, not merely formatting.

| Field | Accepted value | Meaning |
| --- | --- | --- |
| `type` | One supported modifier or special-effect string | Chooses the mechanic and, for modifiers, the damage-equation bucket. |
| `value` | Usually a number or per-level numeric array | Percentage magnitude for modifiers; damage multiplier percentage for `extra_skill_attack`; fixed unit order for `attack_order`. |
| `units` | `{ applies_to?, applies_vs? }` | Resolves which troop lines may receive/use the effect and which opposing troop lines it applies against. |
| `duration` | `{ turns?, attacks? }` | Optional round window and/or use limit. Omitted means the effect is permanent. |
| `same_effect_stacking` | `add` or `max` | Controls overlap between live activations of the same modifier definition and scope. Omitted means `add`. |
| `value_evolution` | Evolution object | Optionally changes the effect value as rounds or uses advance. |
| `trigger_damage_jobs` | Non-empty array of job definitions | Required for `extra_skill_attack`; describes the actual skill-damage jobs it emits. |

### `value` and level selection

For percentage-bucket modifiers, every configured scalar/array entry must be a finite, non-negative JSON number. Missing `value` is permitted and resolves to 0. Use a positive magnitude with a `.down` effect type; negative values are rejected rather than treated as the opposite direction.

```json
"value": [5, 10, 15, 20, 25]
```

At level 3 this resolves to 15. A scalar number gives the same value at every level. Numeric arrays are selected by level before effects reach the runtime.

`dodge` and `no_attack` ignore `value`; their probability belongs on the skill trigger. `extra_skill_attack` is not covered by the percentage-bucket value validator: its resolved `value` is converted to a number, and a missing, non-finite, zero, or negative value produces no damage jobs.

## Modifier effect types

Modifier names identify a damage-equation bucket. The general forms are:

| Form | Accepted middle values | Meaning |
| --- | --- | --- |
| `passive.<stat>.<direction>` | `stat`: `attack`, `lethality`, `health`, `defense`; `direction`: `up`, `down` | Permanent deterministic battle-start stat modifiers folded into the static damage profile. |
| `active.hero.<property>.<direction>` | `property`: `attack`, `lethality`, `health`, `defense`, `damage`, `damageTaken`; `direction`: `up`, `down` | Runtime modifier in a hero-labelled bucket. All combinations are supported even if the current hero files use only a subset. |
| `active.troop.<property>.<direction>` | Same values as `active.hero` | Runtime modifier in a separate troop-labelled bucket. Supported by the engine but not currently used in hero definitions. A hero effect placed here is still reported as hero-sourced; only its equation bucket changes. |
| `type.all.damage.<direction>` | `up`, `down` | Modifier applied to both normal and skill damage. |
| `type.normal.damage.<direction>` | `up`, `down` | Dealer-side modifier for normal attacks only. |
| `type.normal.damageTaken.<direction>` | `up`, `down` | Taker-side modifier for normal attacks only. |
| `type.skill.damage.<direction>` | `up`, `down` | Dealer-side modifier for generated skill attacks only. |
| `type.skill.damageTaken.<direction>` | `up`, `down` | Taker-side modifier for generated skill attacks only. |

These effects do not mutate a fighter's stored Attack, Defense, Health, or Lethality. When an applicable damage job is calculated, they contribute factors to that job's equation. Expiry therefore affects future jobs only; it does not require undoing a stat mutation.

The current hero JSON files use only the subset listed by the inventory at the end of this guide. The additional combinations above are nevertheless registered native buckets. `active.hero.*` and `active.troop.*` are not source-validated: a hero definition can write to either family. The families are separate factors, so identical hero- and troop-labelled bonuses multiply rather than add together.

The four stat/property roles are important:

- `attack`, `lethality`, and `damage` describe the **damage dealer**;
- `health`, `defense`, and `damageTaken` describe the **damage taker**;
- `.up` factors are placed in the damage numerator;
- `.down` factors are placed in the denominator.

For example, `active.hero.damage.down` with `applies_to: "enemy.any"` reduces damage dealt by enemy troops. `active.hero.damageTaken.up` with `applies_to: "trigger.target"` increases damage received by the attacked troop.

**Gotcha — `.down` is denominator-based, not subtractive.** A 20% `.down` contribution divides damage by `1.20`; it does not multiply damage by `0.80`. Likewise, reducing a taker's health or defense by 20% contributes a `1.20` numerator factor. This makes equal `.up` and `.down` magnitudes mathematical opposites in factor placement, but not ordinary `+20%`/`-20%` percentage arithmetic.

Percentages in one ordinary bucket add: two live `active.hero.damage.up` contributions of 10 and 20 produce that bucket's `1 + 0.10 + 0.20 = 1.30` factor. Distinct buckets multiply in the final equation. `type.all.damage.up/down` is the exception: its contributions multiply as individual percentage factors rather than adding into one percentage total.

### Passive restrictions

`passive.*` effects are static profile inputs and must satisfy all of these rules:

- trigger type is `battle_start`;
- no trigger probability;
- no `duration`;
- no `value_evolution`;
- no `same_effect_stacking: "max"` (passives add);
- only `units.applies_to` affects passive scope; `applies_vs` is not used when the static contribution is built.

## `units`: effect scope and usage gates

`units.applies_to` identifies the troop line described by the effect. `units.applies_vs` is the counterpart-line gate for uses of that effect. Most valid combat jobs are cross-side, but the selector itself is resolved independently and can be misconfigured to the same side.

The defaults are:

- omitted `applies_to`: all unit types on the skill owner's side;
- omitted `applies_vs`: all unit types on the side opposite the resolved `applies_to` side.

Unqualified unit strings and arrays use those same default sides. `self.*` and `enemy.*` are always relative to the **skill owner**, not relative to the normal attack that may be using the effect. Trigger-relative selectors are the forms that follow the concrete dealer/taker intent.

This means `applies_to` is not always “the attacker” or always “the target.” The effect type's dealer/taker role determines how the scope is matched to a damage job.

Supported values for either field include:

- a canonical unit string, such as `"lancer"`;
- a non-empty unit array, such as `["infantry", "marksman"]`;
- `"any"` or, for `applies_to` only, `"all"`;
- `"self"`, `"self.any"`, `"self.all"`, `"self.<unit>"`;
- `"enemy"`, `"enemy.any"`, `"enemy.all"`, `"enemy.<unit>"`;
- `"trigger.source"` or its short alias `"trigger"`;
- `"trigger.target"` or its short alias `"target"`.

`applies_vs: "all"` is deliberately rejected; use `"any"`. `units.side` is also rejected. Side belongs in relation-qualified selectors such as `enemy.any`.

`trigger.source`/`trigger` resolve to the intent's dealer side and unit. `trigger.target`/`target` resolve to its taker side and unit. They are meaningful for `attack` triggers and valid per-unit `turn` intents. They are rejected on `battle_start` effects because no such intent exists.

**Gotcha — global turn triggers have no concrete source or target.** On a `turn` trigger with no `trigger.source`, the activation has no attack intent. Trigger-relative effect selectors consequently retain their precompiled fallback: all units on that field's default side. The loader records an `ambiguousTurnTriggerSelectors` diagnostic but does not reject the definition.

The current `Sonya.json` `TorrentialImpact/2` definition is affected. Its global turn trigger gives `applies_to: "trigger.target"` no target to resolve, so it becomes all troops on Sonya's own side. Because the effect is `no_attack`, it cancels Sonya's side's normal attacks on the trigger round. A trace with only this skill shows the round-5 Lancer attack cancelled and `TorrentialImpact/1`'s one-use extra-skill effect surviving until it is used on round 6. This is the runtime behaviour of the current JSON, despite the description saying the enemy target is stunned.

The parser also accepts `"friendly"`, but only as “all units on this field's default side.” It is not an owner-relative synonym in every context. No current hero definition uses it; use `self.any`, `enemy.any`, or `any` instead.

## Duration

`duration` may contain `turns`, `attacks`, or both. Each axis accepts:

```json
{
  "duration": {
    "turns": { "delay": 1, "count": 2 },
    "attacks": { "delay": 1, "count": 3 }
  }
}
```

`count` must be an integer at least 1. `delay` must be an integer at least 0. If both axes are present, they are independent constraints on the same instance. Turn expiry or exhaustion of the attack-use budget removes the effect, whichever happens first.

### `turns`

`turns` are 1-based simulator rounds and are processed at round boundaries.

- An effect created during round `R >= 1` with no turn delay starts immediately in `R`.
- For an effect created during round `R >= 1`, `delay: 1` starts it at the beginning of round `R + 1`.
- `count: 1` expires it at the beginning of the round after its first active round.
- A delay without a count postpones activation and then leaves the effect permanent.

For example, an attack-triggered effect created during round 3 with `{ "turns": { "delay": 1, "count": 2 } }` is active in rounds 4 and 5 and expires at the start of round 6.

An attack-triggered effect with `{ "turns": { "count": 1 } }` is available for later jobs in the same round, but expires before the next round begins. It does not mean “the next full turn.”

**Battle-start delay gotcha.** Battle-start effects are created at setup round 0, while the earliest active round is clamped to 1. Consequently, both `turns.delay: 0` and `turns.delay: 1` start in round 1. A battle-start effect needs `delay: 2` to begin in round 2. No current hero definition combines `battle_start` with a turn delay, but the distinction matters when authoring one.

### `attacks`

`attacks.count` is a limit on the number of times that particular effect instance participates in the relevant mechanic. “Attack” here is not uniformly synonymous with “normal attack”:

- a modifier use is an applicable normal **or skill** damage job to which it contributes a non-zero value;
- an extra-skill use is one eligible normal attack that emits at least one job, regardless of how many target jobs it emits;
- a control use is an attack it cancels;
- an attack-order use is an attack whose target order it chooses.

`attacks.delay` skips that many otherwise-eligible mechanic uses before the effect can apply. For a modifier this means applicable damage jobs; for extra attacks, controls, and attack order it means applicable normal attacks. The last skipped use is not also the first active use. Delay decrements only when the effect's side/unit/job-kind gates otherwise match.

For an effect created by an `attack` trigger, the triggering normal intent is eligible to be its first use because attack skills activate before controls and damage. Thus `attacks.delay: 1` normally skips that current matching intent and begins with the next eligible one; it does not mean “wait one complete round.” The all-intents trigger phase can make the first eligible use a different, earlier intent in the same round when the effect has broad scope.

Cancelled attacks normally still consume applicable attack-limited modifiers and controls because the attack was declared even though it did not land. Permanent modifiers without an `attacks` duration are not use-charged through this cancellation path merely because they have `value_evolution.step: "attack"`. Simulation options can disable cancellation charging separately for dodge or no-attack, but those options are outside the hero JSON.

## `same_effect_stacking`

| Value | Behaviour |
| --- | --- |
| `add` | Every live activation contributes. This is the default. |
| `max` | Only the live activation with the greatest current value contributes for an overlapping job. |

This setting is implemented only for dynamic percentage modifiers. The group identity is the **same originating config effect object on the same owner side plus the same resolved `applies_to`/`applies_vs` side-and-unit masks**. Repeated activations and duplicate main/joiner instances of the same hero definition can therefore share a group. Different config effects do not share a max group merely because their IDs or `type` strings match.

Only the exact string `"max"` selects max behaviour. `"add"` is the documented alternative and default, but the loader currently does not reject other values; every value other than exact `"max"` silently normalizes to `add`. Treat that fallback as weak validation, not as support for additional modes.

For `max`, the greatest **current** value is chosen on each applicable job, so value evolution can change the winner. If the selected value is non-zero, all eligible sibling activations are use-charged, including suppressed siblings. If the selected value is zero, none is charged. Charging the whole eligible group prevents a weaker suppressed copy from waiting untouched and taking over later with a fresh attack budget.

Passive effects reject `max` and remain additive. `extra_skill_attack` rejects the field entirely because every applicable extra-attack effect independently emits its own jobs. The loader does not reject the field on `dodge`, `no_attack`, or `attack_order`, but those runtime paths do not implement add/max grouping, so setting it there has no mechanical effect.

## `value_evolution`

The runtime-recognized shape is:

```json
{
  "value_evolution": {
    "type": "pct_decay",
    "step": "attack",
    "value": 15
  }
}
```

| Field | Accepted runtime values | Meaning |
| --- | --- | --- |
| `type` | `pct_decay`, `fixed_decay` | `pct_decay` multiplies by `max(0, 1 - value/100)` per step. `fixed_decay` subtracts `value` percentage points per step, floored at zero. |
| `step` | `attack`, `round`, `turn` | `attack` uses the effect's mechanical-use count. `round` and `turn` are synonyms and use elapsed active rounds. |
| `value` | Number | Decay amount. |

For `step: "attack"`, the step count is the effect instance's `uses` counter, with “use” defined by the mechanic in the duration section. The current use reads the value before it is charged, so a 100% effect with 15% attack decay produces 100%, 85%, 72.25%, ... on consecutive uses. Skipped attack delays do not increment `uses`; a zero-valued modifier is not charged; a max-suppressed sibling is charged alongside the selected non-zero member.

For `step: "round"`/`"turn"`, the step count is `current round - first active round`. It advances with time even if the effect has not participated in a damage job. The first active round uses the initial value.

`value_evolution` does not have complete value validation. Unknown types or steps leave the value unchanged; negative decay amounts can increase a value; `pct_decay` amounts of 100 or more clamp the retained factor to zero. Treat only non-negative values with the listed types/steps as supported authoring input. Passive effects reject evolution entirely.

## Special effect types

### `extra_skill_attack`

This creates an active effect that can be used by eligible normal attacks. `units.applies_to`/`applies_vs` gate the parent normal attack; they do not by themselves define the generated jobs. After the parent normal job is calculated, each `trigger_damage_jobs` entry expands into zero or more immediate `kind: "skill"` jobs.

`value` becomes the generated job's source multiplier: `100` means `1.0`, `25` means `0.25`, and `200` means `2.0`. The result is a **new full damage calculation**, not that percentage of the parent normal job's final kills or raw damage. It uses the generated source/target pair, round-start troop counts, the ordinary static factors, general active modifiers, and skill-only type modifiers. Normal-only type modifiers do not apply.

Requirements:

- `trigger_damage_jobs` must be a non-empty array;
- every job must have `source` and `target`;
- `same_effect_stacking` is not allowed;
- generated jobs do not trigger `attack` skills recursively;
- every generated job that actually runs advances its dealer's attack counter and taker's received counter when the round commits;
- each live applicable extra-attack effect runs independently; there is no max/add suppression between them.

Each job has this shape:

```json
{
  "source": "use.source",
  "target": "enemy.living"
}
```

Supported `source` and `target` selectors are:

| Selector | Meaning |
| --- | --- |
| `use.source` | Dealer of the normal attack that is using the effect. |
| `use.target` | Taker of that normal attack. |
| `effect.applies_to` | Every unit type in the effect's resolved `applies_to` scope. |
| `effect.applies_vs` | Every unit type in the effect's resolved `applies_vs` scope. For a target selector, `applies_vs` must be concrete: a unit/list or trigger target, not unrestricted `any`. |
| `self.living` | Every troop type with a positive round-start count on the normal dealer's side. |
| `enemy.living` | Every troop type with a positive round-start count on the normal target's side. |
| A canonical unit string | `infantry`, `lancer`, or `marksman` on the normal dealer's side when used as `source`, or normal target's side when used as `target`. Unlike general unit scopes, trigger-job validation requires these exact strings. |
| A canonical unit array | Every listed canonical unit on the same role-dependent side. The array must be non-empty. |

If selectors produce multiple sources and targets, the simulator considers their Cartesian product. Sources or targets with zero round-start troops are skipped. In normal PvP mode, a target already exhausted by earlier same-round jobs is also skipped before calculation. For example, one source and `enemy.living` can produce up to three skill jobs, but fewer may actually run.

The job selector determines the actual side as well as the unit. The runtime does not enforce that a generated source and target are opponents, so scopes misconfigured onto the same side can generate friendly-fire or same-side jobs.

The extra-attack effect is charged once for the parent normal attack if at least one of its jobs runs. If its `value` is non-positive, every job lacks living source/target troops, or every job is skipped because its target is already exhausted, the effect is not charged and can remain available.

All jobs emitted by one use read the parent extra-attack effect's same current `value`; its use/evolution is charged only after those jobs finish. Other attack-limited **modifier** effects are different: each generated skill job is a separate modifier use, and modifiers are charged after each job, so a one-job modifier can expire before the second target in the same extra attack is calculated.

### `dodge`

Cancels a normal attack based on the **taker**:

- `applies_to` is the troop line dodging/being targeted;
- `applies_vs` is the attacking troop line;
- chance belongs on the skill's `trigger.probability`; it decides whether the control effect is created, not a fresh dodge roll on each later attack;
- `value` is ignored.

### `no_attack`

Cancels a normal attack based on the **dealer**:

- `applies_to` is the troop line prevented from attacking;
- `applies_vs` is the would-be target;
- chance belongs on the skill's `trigger.probability` when needed; it decides whether the control effect is created;
- `value` is ignored.

Attack-triggered controls are activated during the all-triggers phase and can cancel the same normal intent that triggered them. All matching attack skills have already attempted before the cancellation is applied.

If both a no-attack and dodge control apply to the same normal attack, no-attack wins. If several live controls of the same type match, the last one encountered is reported as the winning control; matching attack-limited controls can still be charged together. `same_effect_stacking` does not select among controls.

**One-use control gotcha.** Control applicability is determined for every normal intent in the round before any of those intents is processed and charges a use. A broad control with `attacks.count: 1` can therefore already be attached to several same-round intents and cancel all of them, even though its first cancellation expires it from the live index. The current one-use Reina dodge is narrowed to its concrete triggering dealer/target pair, but the generic duration shape does not itself guarantee only one cancellation per round.

A cancelled normal attack emits no normal damage job and no extra-skill jobs, but it still advances the dealer's normal attack counter and the target's received counter once when the round commits.

### `attack_order`

Overrides target preference for matching normal attacks. Although no current hero definition uses it, it is a supported native effect type.

```json
{
  "type": "attack_order",
  "value": ["marksman", "lancer", "infantry"],
  "units": { "applies_to": "self.any" }
}
```

`value` must be a non-empty all-string array of valid unit names. Because all-string arrays are preserved by level resolution, this is one fixed order for every skill level, not a per-level value array. The simulator chooses the first unit in the array with positive round-start troops. Unlisted unit types are not appended as fallbacks; if none of the listed types is alive, no normal intent is created for that dealer.

Only `units.applies_to` gates which dealer troop lines use the order. `applies_vs` is not consulted by attack-order target selection, even though the current troop-skill `Ambusher` definition supplies it.

Target order is resolved before attack triggers for the round. Orders activated at battle start or round start can affect that round; an order activated by an `attack` trigger cannot affect the already-created intents until a later round. When multiple live orders match a dealer, the first ready effect in runtime insertion order wins and later orders are not consulted. A per-unit turn trigger may use an active order to select its synthetic target, but doing so does not consume an order use. Duration and attack delay/count otherwise work as described above.

## Values currently present in hero definitions

The engine accepts some values not currently used by a hero. This inventory distinguishes the data that exists in this directory from the wider native effect vocabulary documented above.

| Field | Values currently present |
| --- | --- |
| `hero_generation` | `SR`, `S1`, `S1_natalia`, `S1_jeronimo`, `S2` through `S8` |
| `troop_type` | `infantry`, `lancer`, `marksman` |
| `requirements[].type/value` | `engagement_type` with `rally` or `garrison`, always beginning at level 1 |
| `trigger.type` | `battle_start`, `turn`, `attack` |
| `trigger.source` | omitted, `infantry`, `lancer`, `marksman`, `self.any`, `self.all`, `enemy.any` |
| `trigger.target` | omitted or `self.any` |
| `trigger.probability` | omitted or a five-level numeric percentage array |
| `trigger.first` | omitted, 4, or 5 |
| `trigger.every` | omitted, 2, 3, 4, 5, or 6 |
| `units.applies_to` | omitted; unit strings/arrays; `all`; `enemy.any`, `enemy.infantry`, `enemy.marksman`; `target`; `trigger.source`; `trigger.target` |
| `units.applies_vs` | omitted; `any`; unit strings/arrays; `self.any`; `trigger.source`; `trigger.target` |
| `duration.turns` | `count` 1–3; optional `delay: 1`; or `delay: 1` with no count |
| `duration.attacks` | `count: 1` or `count: 10`; no hero currently uses `attacks.delay` |
| `same_effect_stacking` | omitted, `add`, or `max` |
| `value_evolution` | only `{ "type": "pct_decay", "step": "attack", "value": 15 }` |
| `trigger_damage_jobs[].source` | `use.source` |
| `trigger_damage_jobs[].target` | `use.target`, `effect.applies_vs`, `enemy.living`, `["lancer"]`, or `["marksman"]` |
| metadata | `status`/`notes` occur only on Reina's `SwiftJive`; aliases occur only for Ling and Lumak |

Current hero modifier `type` values are:

- passive: `passive.attack.up`, `passive.defense.up`, `passive.health.up`, `passive.lethality.up`;
- active stat: `active.hero.attack.up`, `active.hero.attack.down`, `active.hero.defense.up`, `active.hero.defense.down`, `active.hero.health.up`, `active.hero.health.down`, `active.hero.lethality.up`;
- active damage: `active.hero.damage.up`, `active.hero.damage.down`, `active.hero.damageTaken.up`, `active.hero.damageTaken.down`;
- damage-kind-specific: `type.normal.damage.up`, `type.normal.damageTaken.down`, `type.skill.damage.up`, `type.skill.damageTaken.down`;
- special: `dodge`, `no_attack`, `extra_skill_attack`.

No hero currently uses `active.troop.*`, `type.all.*`, the other registered `type.normal.*`/`type.skill.*` directions, or `attack_order`; those are supported by the shared native engine and used or tested outside this directory.

## Validation and ignored data

The loader performs focused validation, but the JSON is cast into TypeScript interfaces rather than validated by a closed JSON schema. Consequences:

- legacy `legacy`, `effect_op`, and `effect_type` fields are rejected;
- `trigger.first`, static-passive restrictions, bucket values, duration shapes, attack-order values, and extra-skill job shapes receive focused validation;
- `trigger.every`, trigger types/selectors, evolution fields, and many top-level/skill-level fields do not receive equivalent closed validation;
- malformed duration and `trigger_damage_jobs` keys are rejected;
- unknown effect types are added to `config.diagnostics.unsupportedEffects`, but loading does not throw solely for that reason. The skill can still report effect activation even though the unknown effect is not indexed and changes no combat mechanic;
- some unknown or misspelled fields outside tightly validated objects can be silently ignored;
- `description`, `notes`, and `status` never override runtime behaviour.

The current 33 hero files load with zero unsupported-effect diagnostics and one ambiguity diagnostic: Sonya `TorrentialImpact/2`, described in the units section.

After editing definitions, at minimum load the config and inspect both diagnostics arrays, then run the simulator tests and a focused trace that exercises the relevant timing/scope interaction. A definition being valid JSON—or a description sounding plausible—is not evidence that the mechanic behaves as intended.

## Implementation reference

The behaviour described here is owned primarily by:

- `simulator/src/config.ts` — loading, aliases, diagnostics, and config validation;
- `simulator/src/resolve.ts` — hero lookup, skill ordering/levels, requirements, and generation-stat baking;
- `simulator/src/effects.ts` — trigger matching, probability, selectors, durations, stacking defaults, and value evolution;
- `simulator/src/runtimeSkills.ts` — trigger scheduling and prepared modifier groups;
- `simulator/src/simulator.ts` — round/attack phases, controls, extra-skill jobs, counters, and use charging;
- `simulator/src/damageBuckets.ts` and `simulator/src/damage.ts` — effect-type buckets and damage arithmetic;
- `simulator/src/staticDamageProfile.ts` — static/passive contribution selection.
