# Gatot, Crystal Shield, Volley, and FC Troop Battle Evidence

Last consolidated: 2026-07-28

This document collects the concrete battle specifications and results discussed
between 2026-07-22 and 2026-07-26. It also records which conclusions are
implemented in the current codebase, which observations primarily motivated
them, and which parts remain hypotheses.

The purpose is to preserve an evidence ledger. A simulator result demonstrates
what a particular implementation predicts; it is not, by itself, evidence of
how the game works.

## Reading conventions

- **Game** means a result observed in Whiteout Survival and supplied in the
  conversation.
- **Simulator** means a prediction from a particular repository/configuration
  snapshot.
- A result such as `3 / 145 losses` means attacker losses followed by defender
  losses.
- The deterministic T6 cases have a 1,500-round limit unless the battle ends
  sooner.
- The FC9 and T9 cases contain stochastic troop skills. A single game result
  must be judged against a distribution, not only a simulator mean.
- The automated evidence check treats a deterministic case as **OK** only when
  the winner matches, each survivor difference is within `2%` of the two
  armies' combined initial troop count, and the round difference is within the
  greater of `3` rounds or `2%` of the recorded game rounds.
- It treats a stochastic case as **OK** when the recorded winner occurs in at
  least `5%` of replicates and every recorded survivor and round value lies
  inside the central `99%` interval for replicates with that winner. This
  conditions survivor and duration comparisons on reproducing the same battle
  outcome rather than mixing attacker and defender wins.
- Missing values are ignored by the automated assessment, and observations
  without enough information to run are reported as **not assessed**.
- Stats below are the values supplied or visibly displayed in the reports.
  Their conversion into underlying mechanical bonuses is now an open question:
  a displayed `10%` Lethality/Health value may correspond to a `5%` underlying
  bonus. Do not silently halve other displayed values without establishing the
  exact display rule and whether the previously supplied tables were already
  converted.
- Several simulator snapshots predate later changes to troop generation,
  Crystal Shield, Body of Light, Volley, and fractional living-troop handling.
  These are labelled as historical where known.

## 1. Deterministic T6 Gatot threshold series

### Specification

Common setup:

- Attacker: T6 infantry; Gatot `1/2/3`.
- Defender: T6 infantry; Gatot `2/2/2`.
- No Crystal Shield.
- Attacker infantry bonuses:
  - Attack `285.3%`
  - Defense `283.3%`
  - Lethality `0%`
  - Health `0%`
- Defender infantry bonuses:
  - Attack `326.1%`
  - Defense `330.1%`
  - Lethality `18.2%`
  - Health `18.2%`

### Results

| Attacker | Defender | Game | Historical simulator in original evidence | Current simulator after later troop/stat changes |
|---:|---:|---|---|---|
| 4,900 | 1,000 | Draw; losses `3 / 4` | Draw; losses `3 / 4` | Draw; losses `3 / 4` |
| 4,950 | 1,000 | Draw; losses `3 / 145` | Draw; losses `3 / 178` | Draw; losses `3 / 161` |
| 5,000 | 1,000 | Draw; losses `3 / 487` | Draw; losses `3 / 518` | Draw; losses `3 / 498` |
| 5,050 | 1,000 | Draw; losses `3 / 926` | Draw; losses `3 / 965` | Draw; losses `3 / 934` |
| 5,100 | 1,000 | Attacker wins in `1,381` rounds | Attacker wins in `1,374` rounds | Attacker wins in `1,380` rounds |
| 10,000 | 2,000 | Attacker wins in `452` rounds | `452` rounds | `452` rounds |
| 20,000 | 4,000 | Attacker wins in `337` rounds | `337` rounds | `337` rounds |

### What this series establishes

- Gatot S2 is a strong raw-offset-like mechanic with square-root army scaling.
- The transition around 5,000–5,100 is highly sensitive and constrains total
  shield magnitude.
- Scaling 10k/2k to 20k/4k constrains the troop-count term.
- Because every side has only one attacking formation, these battles do not
  constrain mixed-formation shield allocation.
- They do not uniquely identify the internal decomposition of `Attack` and
  `Health`, because most stats remain fixed across the series.

### Primary implementation decisions driven by this series

This was the main evidence for the current Gatot source basis:

```text
shield = X% * sqrt(ceil(current source infantry))
             * effective source Attack
             / effective source Health
```

It was also primary evidence for keeping Gatot's configured S2 values fixed at
`[6, 12, 18, 24, 30]`.

## 2. Deterministic T6 defender Health ×1.1 perturbation

### Specification

Same troops, heroes, and stats as section 1, except the defender's effective
Health multiplier receives another ×1.1.

Under the earlier direct-input interpretation:

```text
1.182 * 1.1 = 1.3002
```

which was entered as approximately `30.0%` or exactly `30.02%` Health.

The displayed bonus is the % over and above the basic 100% that all units naturally have. 18.2% bonus means the unit has 118.2% of its basic stat. A 19% buff on that means a 1.1 multiplier on 118.2 = 130.02. Omitting the 100% basic value once again leads to the displayed 30.0%. That is how a 10% buff on 18.2% becomes 30.0%.

### Results

| Attacker start | Game defender survivors | Historical simulator | Current simulator | Game attacker survivors | Simulator attacker survivors |
|---:|---:|---:|---:|---:|---:|
| 4,950 | 904 | 881 | 892 | 4,947 | 4,947 |
| 5,000 | 670 | 650 | 662 | 4,997 | 4,997 |
| 5,050 | 406 | 386 | 401 | 5,047 | 5,047 |
| 5,100 | 80 | 56–57 | 77 | 5,097 | 5,097 |
| 5,150 | 0 | 0 | 0 | 5,147 | 5,147 |

### What this series establishes

- This is the principal evidence that Health participates in the current Gatot
  source basis.
- It strongly rejects many simple alternative Defense/Health multipliers that
  can be tuned to the unperturbed threshold series.
- Its interpretation now depends on resolving report-display
  Lethality/Health semantics.

## 3. Deterministic T6 infantry versus infantry+lancer distribution battle

### Specification

Attacker:

- 5,000 T6 infantry.
- Gatot `1/3/3`.
- Infantry bonuses:
  - Attack `295.3%`
  - Defense `293.3%`
  - Lethality `10%`
  - Health `10%`

Defender:

- 1,000 T6 infantry.
- 10 T6 lancers.
- Gatot `2/2/2`.
- Gordon `3/3/3`.
- Infantry bonuses:
  - Attack `326.1%`
  - Defense `330.1%`
  - Lethality `18.2%`
  - Health `18.2%`
- Lancer bonuses:
  - Attack `284.8%`
  - Defense `288.8%`
  - Lethality `18.2%`
  - Health `18.2%`

No Crystal Shield.

### Results

| Source | Rounds | Attacker infantry | Defender infantry | Defender lancers |
|---|---:|---:|---:|---:|
| Game | 1,151 | 4,573 | 0 | 0 |
| Historical simulator | 1,153 | 4,557 | 0 | 0 |
| Current simulator | 1,157 | 4,551 | 0 | 0 |

### What this battle establishes

- Duplicating Gatot's full turn shield independently against every enemy troop
  type is wrong.
- The available shield must be apportioned across incoming formation attacks.
- A fixed initial-formation weighting reproduces this battle very closely.

### Implemented distribution

For each attacking formation:

```text
weight(unit) =
    ceil(sqrt(initial formation count) * sqrt(smaller initial total army))

normalized_share(unit) = weight(unit) / sum(all attacking formation weights)

share(unit) =
    1                                                  if it is the only formation
    normalized_share / hypot(1, normalized_share)     otherwise
```

For the 1,000 infantry + 10 lancer side:

```text
infantry weight = 1005
lancer weight   = 101
normalized shares = 1005/1106 and 101/1106
```

The independent `hypot` dilution was added after the section 15 mixed-formation
series. It deliberately allows the reservations for multiple incoming formations
to sum to less than one full shield; the unused portion is not reallocated. This
battle remains the primary check that a tiny secondary formation is not given an
independent full shield. Both the weight and dilution formulas remain model
inferences rather than independently confirmed game documentation.

## 4. Stochastic FC9 Gatot versus Gatot series

### Specification

Attacker:

- T11 FC9 infantry.
- Gatot `5/5/5`.
- Bonuses:
  - Attack `1513.0%`
  - Defense `1634.1%`
  - Lethality `831.2%`
  - Health `1103.1%`

Defender:

- T10 FC9 infantry.
- Gatot `5/5/5`.
- Bonuses:
  - Attack `1354.0%`
  - Defense `1413.7%`
  - Lethality `634.3%`
  - Health `812.6%`

Crystal Shield is present and visibly activates. Body of Light is also
available at FC9. The battles are stochastic.

### Game observations and original simulator snapshot

The simulator means below were the 500-run means supplied in the original
evidence. They predate some later troop-stat and Crystal/Body configuration
changes.

| Starting troops per side | Game rounds | Game Crystal activations A/D | Game attacker survivors | Historical simulator mean rounds | Historical simulator mean attacker survivors |
|---:|---:|---:|---:|---:|---:|
| 10,000 | 923 | 364 / 320 | 9,992 | 1,334.1 | 9,994.3 |
| 20,000 | 702 | 250 / 270 | 19,983 | 1,016.1 | 19,988.7 |
| 40,000 | 610 | 215 / 246 | 39,135 | 736.7 | 38,652.1 |
| 90,000 | 560 | 228 / 231 | 83,565 | 587.0 | 82,794.2 |

### Interpretation status

- The deterministic T6 evidence supports Gatot's approximate total shield but
  does not validate Crystal Shield or Body of Light.
- After later troop-stat updates and interpreting Crystal Shield as a 36%
  damage-taken reduction, these cases became broadly compatible with the
  simulator. The exact refreshed run table was not preserved in the available
  conversation transcript and should be regenerated before claiming precise
  current parity.
- The 90k observation was close to a tail of the simulated joint
  duration/survivor distribution. Duration and survivors are strongly coupled
  through the multi-round feedback loop; treating them as independent
  discrepancies exaggerates the evidence against a candidate.
- No fractional-exponent or target-offensive-stat fitted formula was accepted.

## 5. Stochastic FC9 Gatot + Lumak series

### Specification

Same troop tiers, troop counts, bonuses, and Gatot levels as section 4.

- Attacker additionally has Lumak S1 level 5.
- Defender remains Gatot `5/5/5`.
- Crystal activation counts were not supplied.

### Results

| Starting troops per side | Game rounds | Game attacker survivors | Historical simulator mean rounds | Historical simulator mean attacker survivors |
|---:|---:|---:|---:|---:|
| 20,000 | 705 | 19,986 | 1,017.8 | 19,991.2 |
| 40,000 | 598 | 39,914 | 724.1 | 39,746.1 |
| 90,000 | 554 | 86,767 | 577.8 | 85,952.5 |

These cases primarily constrain the interaction between Gatot, Crystal Shield,
Body of Light, and Lumak rather than mixed-formation distribution.

## 6. Historical T11 FC10 infantry versus T6 marksmen

This series preceded replacement of the high-FC JSON catalogue with generated
stats. Its T11 FC10 base values are therefore a historical snapshot, not the
current catalogue.

### Specification

Attacker:

- T6 marksmen.
- No heroes.

Defender:

- One T11 FC10 infantry.
- Gatot `5/5/5`.

Recovered historical defender data:

- Base Attack `840`.
- Base Health `2520`.
- Effective Attack factor `22.596`.
- Effective Health factor `22.397`.
- Gatot level-5 shield calculation:

```text
(sqrt(1) * 840 * 22.596) / (2520 * 22.397) * 30%
    = approximately 0.1009
```

The complete attacker stat block was supplied by screenshot but is not
recoverable as text from the available transcript.

### Results

| T6 marksmen start | Game result | Historical simulator |
|---:|---|---|
| 10,000 | Draw at 1,500; 5,895 marksmen and 1 infantry survive | Draw at 1,500; 6,092 marksmen and 1 infantry survive |
| 3,000 | All marksmen die in round 1,086; infantry survives | About 1,097 rounds with a +5% infantry Attack hypothesis, or 1,086 with a +6% hypothesis |

### Conclusions

- Gatot alone made the infantry impenetrable; Crystal Shield randomness did not
  affect marksman casualties in these battles.
- The simulator's infantry attack dealt
  `2.6058267739913017` marksmen casualties per round.
- The 10k game result implies approximately `2.7366667` per round.
- Death in round 1,086 implies approximately `2.762431–2.764977` per round.
- A single static base-stat multiplier could not fit both observations exactly.
- These observations motivated re-examining extrapolated FC6–FC10/T11 troop
  stats and replacing the old JSON catalogue with generated stats.

## 7. T1 FC10 infantry versus T6 marksmen

### Specification

Attacker:

- 10,000 T6 marksmen.
- No heroes.
- Relevant displayed marksman bonuses:
  - Attack `208.8%`
  - Defense `207.1%`
  - Lethality `158.8%`
  - Health `164.7%`

Defender:

- One T1 FC10 infantry.
- Gatot `5/5/5`.
- Relevant displayed infantry bonuses:
  - Attack `2159.6%`
  - Defense `2185.6%`
  - Lethality `1942.2%`
  - Health `2139.7%`

At FC10 the infantry also has Crystal Shield and Body of Light.

### Game result

- Draw at the round limit.
- 9,540 T6 marksmen survive.
- The single infantry survives.

### Use in the investigation

- The infantry's observed outgoing damage was a principal reason for choosing a
  T1 FC10 base Attack near `99`.
- It did not independently determine whether T1 FC10 infantry Health should be
  `296`, `297`, or `298`, because Gatot already protected the infantry.
- The current generated catalogue uses Attack `99`, Health `296`.

## 8. T1 FC10 infantry versus T9 marksmen

### Common specification

Attacker:

- T9 marksmen.
- No heroes.
- Displayed marksman bonuses:
  - Attack `208.8%`
  - Defense `207.1%`
  - Lethality `158.8%`
  - Health `164.7%`
- T9 Volley is active and stochastic.

Defender:

- One T1 FC10 infantry.
- Gatot `5/5/5`.
- Displayed infantry bonuses:
  - Attack `2159.6%`
  - Defense `2185.6%`
  - Lethality `1942.2%`
  - Health `2139.7%`
- Crystal Shield and Body of Light are active and stochastic.

Unless otherwise stated, a surviving infantry at round 1,500 means a draw even
though thousands of marksmen also survive.

### Supplied game observations

| Marksmen start | Game outcome | Marksmen survivors | Rounds | Volley activations | Crystal Shield activations |
|---:|---|---:|---:|---:|---:|
| 33,510 | Attacker wins | 33,481 | 157 | not supplied | not supplied |
| 33,481 | Attacker wins | 33,452 | 160 | not supplied | not supplied |
| 33,452 | Attacker wins | 33,427 | 135 | not supplied | not supplied |
| 33,427 | Attacker wins | 33,401 | 144 | not supplied | not supplied |
| 30,228 | Attacker wins | 30,205 | 123 | not supplied | not supplied |
| 30,205 | Attacker wins | 30,179 | 139 | not supplied | not supplied |
| 30,179 | Attacker wins | 30,139 | 216 | not supplied | not supplied |
| 30,139 | Attacker wins | 30,116 | 123 | not supplied | not supplied |
| 30,116 | Attacker wins | 30,081 | 189 | not supplied | not supplied |
| 25,000 | Attacker wins | 24,929 | 329 | not supplied | not supplied |
| 20,000 | Attacker wins | 19,943 | 308 | not supplied | not supplied |
| 12,000 | Attacker wins | 11,791 | 1,121 | not supplied | not supplied |
| 11,791 | Attacker wins | 11,548 | 1,300 | 140 | 532 |
| 11,548 | Draw; infantry survives | 11,268 | 1,500 | 140 | 605 |
| 10,000 | Draw; infantry survives | 9,720 inferred from 280 losses | 1,500 | not supplied | not supplied |

The non-monotonic round counts are genuine observations from stochastic
battles, not a deterministic threshold curve.

### Simulator distribution observations after the later implementation changes

- For 12,000 marksmen, the simulator mean duration over 1,000 replicates was
  `900.9` rounds.
- Across those 1,000 replicates, the best supplied survivor result was 11,892
  and the worst was 11,751. The game result 11,791 was inside the simulated
  range.
- With only 20 replicates, the worst simulator result seen was 11,773.
- At 11,548 marksmen, a 1,000-replicate simulator run produced exactly one
  draw. That draw left 11,268 marksmen, exactly matching the supplied game
  survivor count. It was therefore an extreme simulated outcome rather than
  impossible under the implemented candidate.

### Conclusions driven by this series

- Volley should not be represented as a separately recorded skill-damage job:
  the game did not allocate it skill kills in the way genuine extra skill
  attacks do.
- Volley is currently implemented as a 100% `active.troop.damage.up` modifier
  on its triggering normal attack.
- Gatot's shield remains a post-subtract offset and applies to the resulting
  damage job under the current implementation.
- Fractional casualties must still accumulate, but every positive fractional
  formation remainder counts as one living troop for the next attack and for
  Gatot's source troop count.
- A real visible kill occurs when accumulated fractional damage crosses an
  integer troop-count boundary. This drove trace/UI kill-counter corrections.
- These observations support the same qualitative stochastic/threshold
  behaviour as the game, but the exact duration distribution remains imperfect.

## 9. T9 lancers versus T1 FC10 lancers

This series was collected to constrain T1 FC10 lancer durability without Gatot.

### Shared formation specification

Attacker:

- T9 lancers.
- No heroes.
- Ambusher is active.

Defender:

- 146 T1 FC10 lancers.
- No heroes.
- Crystal Lance and Incandescent Field are active.

Each troop type is one formation-level attacking unit. Individual soldiers do
not make independent attacks. A formation may nevertheless attack more than
once in a round through troop skills.

### Observed stat profiles

The first two battles and the remaining four battles used different displayed
stat profiles. They must not be run under one common stat block.

| Battles | Side | Attack | Defense | Lethality | Health |
|---|---|---:|---:|---:|---:|
| 3,000 and 2,201 T9 start | T9 attacker | `208.8%` | `207.1%` | `167.5%` | `167.6%` |
| 3,000 and 2,201 T9 start | FC10 defender | `1179.0%` | `1202.9%` | `1362.1%` | `1134.5%` |
| 1,500, 1,950, 2,100, and 2,200 T9 start | T9 attacker | `208.8%` | `179.2%` | `154.7%` | `154.8%` |
| 1,500, 1,950, 2,100, and 2,200 T9 start | FC10 defender | `1306.9%` | `1333.2%` | `1508.3%` | `1258.0%` |

### Game results

| T9 lancers start | Winner | T9 survivors | FC10 survivors | Ambusher | Crystal Lance | Incandescent Field |
|---:|---|---:|---:|---:|---:|---:|
| 3,000 | T9 | 2,201 | 0 | 9 | 6 | 8 |
| 2,201 | T9 | 1,233 | 0 | 5 | 8 | 5 |
| 1,500 | FC10 | 0 | 85 | 3 | 8 | 2 |
| 1,950 | FC10 | 0 | 45 | 7 | 11 | 6 |
| 2,100 | FC10 | 0 | 37 | 16 | 14 | 7 |
| 2,200 | FC10 | 0 | 20 | 20 | 14 | 13 |

For the 3,000-versus-146 battle, activation counts suggested approximately
45–50 rounds, but no direct round count was available because there was no
every-round Gatot activation to use as a counter.

### Conclusions and current implementation

- The series did not cleanly distinguish a one-point T1 FC10 lancer Health
  difference because multiple stochastic skills strongly affect the endpoint.
- It is supporting calibration evidence, not a precise solved stat measurement.
- The evidence runner preserves the two observed displayed-stat profiles rather
  than applying the first profile to all six battles.
- The current catalogue uses T1 FC10 lancer Attack `296`, Health `99`, obtained
  by swapping the generated T1 FC10 infantry Attack/Health pair.

## 10. Current T6 Bradley mixed battle

### Specification

Attacker:

- 1,000 T6 infantry.
- 125 T6 marksmen.
- Gatot `2/2/2`.
- Bradley `3/3/3`.
- Infantry bonuses:
  - Attack `326.1%`
  - Defense `330.1%`
  - Lethality `18.2%`
  - Health `18.2%`
- Marksman bonuses:
  - Attack `284.8%`
  - Defense `288.8%`
  - Lethality `18.2%`
  - Health `18.2%`

Defender:

- 5,000 T6 infantry.
- Gatot `1/3/3`.
- Displayed infantry bonuses:
  - Attack `295.3%`
  - Defense `293.3%`
  - Lethality `10%`
  - Health `10%`

No Crystal Shield.

### Results

| Source/input interpretation | Outcome | Rounds | Defender infantry survivors | Attacker infantry death |
|---|---|---:|---:|---:|
| Game | Defender wins | 875 | 2,296 | Round 868 |
| Simulator before mixed-share dilution | Defender wins | 688 | 2,769 | Round 681 |
| Current simulator with mixed-share dilution | Defender wins | 708 | 2,597 | not regenerated |

### Pre-dilution simulator arithmetic

Current shield values:

- Attacker Gatot level 2 shield: approximately `4.55364025`.
- Defender Gatot level 3 total shield: approximately `15.22562222`.

Fixed initial attacker formation weights:

- Infantry weight `1061`.
- Marksman weight `375`.
- Infantry share `73.8857939%`.
- Marksman share `26.1142061%`.

Representative round-two attacks:

| Attack | Damage before Gatot | Gatot allocation | Damage bypassing |
|---|---:|---:|---:|
| Attacker infantry -> defender infantry | 4.452293 | 11.249572 | 0 |
| Attacker marksmen -> defender infantry | 6.277518 | 3.976050 | 2.301467 |
| Defender infantry -> attacker infantry | 5.477137 | 4.553640 | 0.923497 |

The defender therefore removes about 83% of its incoming pre-shield damage in
the representative right-to-left attack. Small primitive changes can produce
large duration changes through the hundreds-of-round feedback loop.

### Shield-distribution probes

Changing only the normalized fixed shield share could not reproduce both game
duration and defender survivors:

| Candidate | Infantry allocation | Result |
|---|---:|---|
| Current weights | 73.8858% | 688 rounds; 2,769 defenders |
| `sqrt(min initial infantry)` multiplier with ceil | 73.8552% | 688 rounds; 2,772 defenders |
| Same multiplier with floor | 73.9098% | 689 rounds; 2,763 defenders |
| Diagnostic fixed share near 76% | about 76% | 743 rounds; 2,306 defenders |
| Diagnostic fixed share near 78.6% | about 78.6% | 875 rounds; 1,372 defenders |

Global count-exponent and stat-weighted alternatives also broke the earlier
infantry+lancer case. No replacement distribution was accepted.

### Lethality/Health sensitivity probes

With every other input unchanged:

| Defender Lethality / Health input | Result |
|---|---|
| `10 / 10` | Defender wins in 688; 2,769 defenders |
| `10 / 0` | Defender wins in 745; 2,248 defenders |
| `0 / 10` | Attacker wins in 1,249; 878 infantry + 125 marksmen |
| `0 / 0` | Attacker wins in 1,135; 897 infantry + 125 marksmen |

The 10% Lethality input is amplified by post-subtraction:

```text
with 10%: 5.477137 - 4.553640 = 0.923497 bypass
with  0%: 4.979216 - 4.553640 = 0.425576 bypass
```

Applying Gatot wholly before player Lethality was tested and rejected:

- Current battle flipped to an attacker win in 1,491 rounds.
- The earlier infantry+lancer case reached the 1,500-round limit with both
  sides alive.

### Current status

This battle is not explained by the current candidate. It introduces Bradley
and a marksman formation, neither of which was present in the original
infantry-only Gatot derivation. Ordinary damage is treated as fixed; the open
areas are display-stat semantics, Bradley application details, and Gatot shield
application/distribution details that can also preserve the earlier cases.

## 11. Current implemented mechanics and their evidence

### 11.1 Gatot S2

Current implementation:

- Configured values `[6, 12, 18, 24, 30]`.
- Triggered by the infantry formation's attack.
- Materialized with a one-turn delay for one turn.
- Source basis:

```text
sqrt(ceil(current source infantry))
    * effective Attack
    / effective Health
```

- Raw `active.hero.shield` offset.
- Applied after the complete damage expression as `post_subtract`.
- `same_effect_stacking: max`.
- A turn shield is not consumed by one attack. With one incoming formation its
  full value applies. With multiple incoming formations, each fixed normalized
  attack-weight share `r` receives `r / hypot(1, r)` of the shield; reservations
  intentionally sum to less than one full shield and do not spill over.

Primary evidence:

1. T6 threshold series.
2. T6 defender Health ×1.1 series.
3. T6 infantry versus infantry+lancer distribution battle.
4. T9 marksmen versus one FC10 infantry for fractional living-troop handling.

Status:

- **Implemented candidate.**
- Strongly constrained by deterministic T6 evidence.
- Not conclusively established as the exact live-game formula.
- The Bradley mixed battle remains incompatible.

Relevant code:

- `simulator/config/hero_definitions/Gatot.json`
- `simulator/src/simulator.ts` (`sourceAttackProtectionBasis`)
- `simulator/src/damage.ts`
- `simulator/src/gen8Heroes.test.ts`
- Commit `e1df86c` and distribution commit `52dc844`

### 11.2 Crystal Shield

Current implementation:

- Trigger probabilities `25%` and `37.5%`.
- Value `36`.
- One applicable incoming attack.
- Implemented as `active.troop.damageTaken.down`, not a raw shield.
- Its denominator factor is `1.36`.

Primary evidence:

- FC9 Gatot versus Gatot duration/survivor distributions.
- Skill wording “offsetting 36 damage”.
- Better empirical fit of percentage-style `36` than a late-battle raw
  36-casualty shield.

Status:

- **Implemented working interpretation.**
- Not independently confirmed game truth.

Relevant code:

- `simulator/config/troop_skills.json`
- `simulator/src/damageBuckets.ts`
- Commit `21d98c4`

### 11.3 Body of Light

Current implementation:

- FC8/FC9:
  - Infantry Defense up `4%`.
  - Conditional damage-taken reduction `10%` while Crystal Shield applies.
- FC10:
  - Infantry Defense up `6%`.
  - Conditional damage-taken reduction `15%` while Crystal Shield applies.
- Crystal and Body values add in the same damage-taken-down bucket:
  - FC8/FC9 Crystal proc: denominator `1.46`.
  - FC10 Crystal proc: denominator `1.51`.

Primary evidence:

- FC9 Gatot and Gatot+Lumak distributions.
- Skill text saying Body reduces “an additional” amount while Crystal Shield is
  active.

Status:

- **Implemented working interpretation.**
- Whether the Defense increase is always active or only active during Crystal
  remains unconfirmed game behaviour; current code keeps the Defense increase
  active.

### 11.4 Volley

Current implementation:

- 10% trigger chance at T7+.
- The triggering marksman normal attack receives 100%
  `active.troop.damage.up`.
- It does not create a separately recorded skill-damage job.

Primary evidence:

- T9 marksmen versus one T1 FC10 infantry.
- Volley did not receive separately allocated skill kills in game reports.
- The observed threshold behaviour was qualitatively reproduced when Volley
  doubled the triggering normal attack.

Status:

- **Implemented working interpretation.**
- Stronger evidence than the former `extra_skill_attack` representation, but
  not a clean isolated live test.

Relevant code:

- `simulator/config/troop_skills.json`
- `simulator/src/config.test.ts`
- Commit `21d98c4`

### 11.5 Fractional casualties and living troop counts

Current implementation:

- Damage and troop counts retain fractional values internally.
- Every positive fractional remainder counts as one living troop for the next
  attack.
- The damage army term uses `ceil(remaining troops)`.
- Gatot's shield source count uses `ceil(remaining infantry)`.
- Visible kills are counted when an integer troop-count boundary is crossed.

Primary evidence:

- T9 marksmen versus one T1 FC10 infantry near the kill threshold.
- Trace inconsistency where the last infantry appeared alive after the battle
  had actually ended.

Status:

- **Implemented engine and trace/UI behaviour.**

Relevant code:

- `simulator/src/damage.ts`
- `simulator/src/simulator.ts`
- `dashboard/web/lib/simulator/simulate.ts`
- Commit `21d98c4`

### 11.6 Generated troop catalogue

Current implementation:

- T1–T10 FC0 anchors are explicit.
- Lancer Attack/Health swap the corresponding infantry pair.
- Marksman anchors are explicit for T1–T10.
- T11 FC0 is anchored from Labyrinth calibration.
- FC multiplier schedule currently implemented:
  - FC0 `1.0`.
  - FC1 `1.04`.
  - FC2–FC7 grow by `1.05` per level.
  - FC8–FC10 grow by `1.04` per level.
- Stats are generated from the base and rounded.

Current T1 FC10 base pairs:

| Type | Attack | Health |
|---|---:|---:|
| Infantry | 99 | 296 |
| Lancer | 296 | 99 |
| Marksman | 395 | 74 |

Primary evidence:

- Existing FC0–FC5 dataset and cross-tier patterns.
- Historical T11 FC10 infantry versus T6 marksmen discrepancy.
- T1 FC10 infantry outgoing damage against T6/T9 marksmen.
- T9 lancer versus T1 FC10 lancer calibration series.

Status:

- **Implemented generated catalogue.**
- The exact FC6–FC10 continuation remains reverse-engineered.
- T1 FC10 Attack `99` has direct outgoing-damage support.
- The exact one-point Health choice is less directly constrained.

Relevant code:

- `simulator/src/troopStats.ts`
- `simulator/src/troopStats.test.ts`
- Commits `dd5b744`, `850e2e2`, `981e92c`, `84fa5a3`, and `21d98c4`

### 11.7 Simulator result and trace display

Implemented after the one-infantry investigations:

- Round 0 shows starting troops.
- Each subsequent trace row shows end-of-round troops.
- Final-round kills reduce the visible surviving count to zero.
- Draws display both attacker and defender survivors.
- Mean survivors use full integer values rather than `k` abbreviation.
- Signed attacker-minus-defender outcome remains for result sets without draws.
- Progress updates are throttled and trace derivation is memoized to avoid
  render loops and large-trace lag.

These are UI/reporting conclusions, not game-mechanic evidence.

## 12. Rejected or unresolved hypotheses

Rejected by cross-case testing:

- Duplicating Gatot's full shield against each incoming formation.
- Global count exponents that allocate materially more shield to infantry.
- Replacing the distribution multiplier with
  `sqrt(min initial infantry)` as a meaningful correction; normalization makes
  it cancel except for negligible integer-rounding differences.
- Base-Health-weighted or current-count dynamic distributions.
- Applying Gatot wholly before player Lethality.
- Adding source or target offensive stats with arbitrary fitted exponents.
- Random fitted constants chosen only to hit one battle.
- Treating Volley as a separately recorded extra skill attack.
- Treating Crystal Shield's `36` as a late-battle raw 36-casualty offset in the
  current candidate.

Still unresolved:

- Exact report-display conversion for Lethality and Health.
- Exact Gatot behaviour in the Bradley mixed battle.
- Gatot interaction with genuine extra skill attacks.
- Whether Body of Light's Defense increase is conditional on Crystal Shield.
- Exact current FC9 distribution after all later code/config/stat changes.
- Whether the remaining T9 duration discrepancy is ordinary stochastic tail
  behaviour or another missing mechanic.
- Exact one-point T1 FC10 infantry/lancer Health calibration.

## 13. Constraints for future hypothesis testing

### Fixed unless independent evidence changes them

- Reported game outcomes, rounds, survivors, and activation counts.
- Troop types, tiers, FC levels, and starting counts.
- Hero lineups and skill levels.
- Gatot S2 configured values `[6, 12, 18, 24, 30]`.
- Crystal Shield, Body of Light, and Volley configured numerical values.
- The well-validated ordinary damage formula.
- No Crystal Shield in the deterministic T6 FC0 cases.
- Existing independently validated no-hero and hero testcase behaviour.

### Open to reinterpretation

- Meaning of Gatot's underlying “Attack” shield basis.
- Gatot shield ordering/application semantics.
- Mixed-formation allocation details, provided the infantry+lancer result is
  preserved.
- Gatot interaction with genuine skill damage.
- Crystal Shield and Body of Light semantic interpretation, provided their
  configured numbers are unchanged.
- Bradley application details not independently isolated.
- The mapping from displayed report stats to underlying mechanical bonuses.
- Reverse-engineered high-FC troop multipliers when new calibration evidence is
  available.

### Methodological constraints

- Do not change supplied evidence independently from one battle to another.
- Do not change Gatot's X% values.
- Do not insert other troop types' Attack into Gatot's infantry shield without
  strong evidence.
- Do not include runtime Attack modifiers in Gatot's shield basis merely to fit
  an endpoint.
- Do not use arbitrary constants or fractional fitted exponents without a
  credible mechanic.
- Check every deterministic T6 breakpoint, the Health perturbation, and the
  mixed infantry+lancer battle before accepting a global Gatot change.
- Check FC9 Gatot and Gatot+Lumak distributions before accepting a global
  Crystal/Body/Gatot interaction change.
- Check the T9 marksman series before changing Volley, fractional living-troop
  handling, or FC10 infantry calibration.
- Check the lancer series before changing T1 FC10 lancer durability.

## 14. Evidence priority by implemented conclusion

| Implemented conclusion | Primary battles | Secondary checks |
|---|---|---|
| Gatot `sqrt(current infantry) * Attack / Health` source basis | T6 threshold series; T6 Health ×1.1 | FC9 Gatot series; T1 FC10 single-infantry battles |
| Gatot fixed formation-weight distribution | 5,000 infantry vs 1,000 infantry + 10 lancers | Current Bradley mixed battle, which exposes an unresolved conflict |
| Gatot post-subtract raw shield | T6 threshold/Health series | FC9 and single-infantry threshold behaviour |
| Crystal Shield as 36% damage-taken reduction | FC9 Gatot series | FC9 Lumak series; implausibility of a raw 36 shield near one remaining troop |
| Body of Light conditional addition | FC9 Gatot and Lumak series | Skill wording and requires-effect behaviour |
| Volley as 100% normal-attack damage-up | T9 marksmen vs one T1 FC10 infantry | Absence of separately allocated Volley skill kills |
| `ceil(positive fractional remainder)` for attacking and Gatot | T9 marksmen vs one T1 FC10 infantry | Trace final-kill inconsistency |
| T1 FC10 base Attack near 99 | T1 FC10 infantry outgoing damage to T6/T9 marksmen | Generated FC continuation |
| T1 FC10 Health 296 / lancer Health 99 | Generated FC model | T9-vs-FC10 lancer series, not conclusive to one point |

## 15. Additional T6 Gatot mixed-formation battles (added 2026-07-27)

These deterministic T6 battles were supplied on 2026-07-26/27 to test whether the
section 10 discrepancy depends on Bradley or on the marksman formation. The per-battle
game results and simulator results are recorded below; the confirmed
simulator-vs-game comparisons and the modifications tested are in 15.4.

### 15.1 Pure Gatot-vs-Gatot, 1k inf + 1k lancer + 1k marksman vs 5k inf

Source run: `https://wos-sim.ratme.org/simulate?run=24d6e68f-e690-4247-9888-01d67fc3bc43`

Attacker:

- 1,000 T6 infantry, 1,000 T6 lancers, 1,000 T6 marksmen.
- Gatot `2/2/2` only (no secondary heroes).
- Infantry bonuses: Attack `326.1%`, Defense `330.1%`, Lethality `18.2%`, Health `18.2%`.
- Lancer bonuses:   Attack `78.1%`,  Defense `82.1%`,  Lethality `18.2%`, Health `18.2%`.
- Marksman bonuses: Attack `78.1%`,  Defense `82.1%`,  Lethality `18.2%`, Health `18.2%`.

Defender:

- 5,000 T6 infantry.
- Gatot `1/3/3` only (no secondary heroes).
- Infantry bonuses: Attack `295.3%`, Defense `293.3%`, Lethality `10%`, Health `10%`.

No Crystal Shield.

| Source | Outcome | Rounds | Defender infantry survivors | Notes |
|---|---|---:|---:|---|
| Game | Defender wins | 238 | 3,064 | Attacker infantry alive for 207 of the 238 rounds; the remaining 31 rounds are spent killing the exposed 1,000 lancers + 1,000 marksmen. |
| Simulator before mixed-share dilution | Defender wins | 226 | 3,303 | Reproduced from the stated inputs with Gatot `2/2/2` (attacker) and `1/3/3` (defender). |
| Current simulator with mixed-share dilution | Defender wins | 230 | 3,139 | Same inputs; closer to the game result. |

This battle has no secondary heroes on either side.

### 15.2 With secondary heroes, 1k inf + 125 lancer + 125 marksman vs 5k inf

Source run: `https://wos-sim.ratme.org/simulate?run=6eaa06b5-cc7a-42e0-ac57-588d62746ae3`

Attacker:

- 1,000 T6 infantry, 125 T6 lancers, 125 T6 marksmen (1,250 total; 80/10/10 split).
- Heroes: Gatot 2/2/2, Gordon 3/3/3, Bradley 3/3/3.
- Infantry bonuses: Attack `326.1%`, Defense `330.1%`, Lethality `18.2%`, Health `18.2%`.
- Lancer bonuses:   Attack `284.8%`, Defense `288.8%`, Lethality `18.2%`, Health `18.2%`.
- Marksman bonuses: Attack `284.8%`, Defense `288.8%`, Lethality `18.2%`, Health `18.2%`.

Defender:

- 5,000 T6 infantry.
- Heroes: Gatot 1/3/3, Patrick 1/0, Bradley 1/3/3.
- Infantry bonuses: Attack `295.3%`, Defense `293.3%`, Lethality `10%`, Health `10%`.

No Crystal Shield.

| Source | Outcome | Rounds | Attacker survivors |
|---|---|---:|---:|
| Game | Attacker wins | 366 | 851 |
| Simulator before mixed-share dilution | Attacker wins | 441 | 641 |
| Current simulator with mixed-share dilution | Attacker wins | 436 | 655 |

The attacker wins in the game and both simulator candidates. The pre-dilution
figures (441 rounds, 641 survivors) are the run page's reported result.

### 15.3 Backline-variation family (same players and Gatot skills)

Supplied 2026-07-27. All battles use the identical roster as 15.1: attacker Gatot
`2/2/2` only, defender 5,000 T6 infantry with Gatot `1/3/3` only, no other heroes,
no Crystal Shield. Attacker infantry bonuses `326.1/330.1/18.2/18.2`; attacker lancer
and marksman bonuses `78.1/82.1/18.2/18.2`; defender infantry bonuses
`295.3/293.3/10/10`. Only the attacking backline composition changes.

"Survivors" is the winner's remaining troops. The simulator values in this table
are the pre-dilution results reproduced from the stated inputs; section 15.5 gives
the current candidate.

| Attacker composition | Game outcome | Game survivors | Game rounds | Pre-dilution sim outcome | Pre-dilution sim survivors | Pre-dilution sim rounds |
|---|---|---:|---:|---|---:|---:|
| 1,000 inf + 1,000 lancer | Defender wins | 4,973 | 266 | Defender wins | 4,990 | 265 |
| 1,000 inf + 1,000 marksman | Defender wins | 4,491 | 278 | Defender wins | 4,796 | 267 |
| 2,000 inf + 1,000 lancer | Defender wins | 4,338 | 545 | Defender wins | 4,626 | 508 |
| 1,000 inf + 1,000 lancer + 1,000 marksman (15.1) | Defender wins | 3,064 | 238 | Defender wins | 3,303 | 226 |
| 2,000 inf + 1,000 marksman | **Attacker wins** | 1,281 | 907 | **Defender wins** | 1,326 | 732 |

The 2,000 inf + 1,000 marksman row is the only one where the simulator and game
disagree on the winner (simulator: defender wins; game: attacker wins). The other
rows agree on the winner and differ on survivors and rounds as tabulated.
Interpretation is in 15.4.

### 15.4 What this series established for the pre-dilution candidate

Confirmed (game observations and simulator-vs-game comparisons):

- 15.1 shows a simulator-vs-game discrepancy (simulator defender 3,303 in 226 rounds;
  game defender 3,064 in 238 rounds) with Gatot as the only hero on both sides. The
  discrepancy therefore does not require Bradley or any secondary hero.
- The discrepancy is not specific to marksmen. The 2,000 inf + 1,000 lancer battle
  (simulator: defender wins, 4,626 survivors, 508 rounds; game: defender wins, 4,338
  survivors, 545 rounds) is a lancer-only case the simulator does not reproduce; it
  under-counts total defender casualties there by ~44% (simulator 374 vs game 662).
- The simulator reproduces sections 1 and 2 (pure infantry), section 3, and 1,000 inf
  + 1,000 lancer. It does not reproduce 1,000 inf + 1,000 marksman, 2,000 inf + 1,000
  lancer, the 1,000 + 1,000 lancer + 1,000 marksman triple, section 10, or 2,000 inf +
  1,000 marksman (where it reports the opposite winner). In each non-reproduced battle
  it under-counts the defender's total casualties, or reports the wrong winner.
- The simulator's total attacker casualty output is below the game's. Example: 1,000
  inf + 1,000 marksman — simulator 204 defender casualties over 267 rounds
  (0.76/round) vs game 509 over 278 rounds (1.83/round).
- Sections 1 and 2 are reproduced to within threshold sensitivity: at 4,950/1,000 the
  simulator's `3/161` vs the game's `3/145` corresponds to ~5 attacker-troops of
  threshold offset (~0.1%), not a systematic bias.

Simulator-internal behaviour (traced from the pre-dilution implementation). Game reports
give only totals and never a per-attacking-formation casualty breakdown, so these
describe what the simulator computes, not independently confirmed game behaviour:

- In these family battles the simulator's front-line infantry deal only a small
  minority of the defender's casualties — 4.5 of 205 (1,000 inf + 1,000 marksman),
  7.8 of 375 (2,000 inf + 1,000 lancer), 15.4 of 1,698 (the triple) — with the back
  line dealing the rest. At the battle start the infantry attack is fully absorbed by
  its shield share (round-2: infantry pre-shield 4.48 vs 7.61 allocated); the small
  infantry-dealt total accrues later in the battle.
- The battles the simulator fails to reproduce are exactly those in which a back-line
  formation's pre-shield damage exceeds its shield share (it bypasses in the
  simulator); the ones it reproduces are those in which the back line is fully
  absorbed (1,000 inf + 1,000 lancer: lancer pre-shield 5.65 vs 7.61 allocated) or
  negligible (section 3, 10 lancers).

Modifications tested during this investigation, each of which broke at least one
reproduced battle or failed to hold a single value across this family (recorded so
they are not re-tried):

- crowding term (`sqrt` of `min_army`) inside the shield source — turns section 1's
  10k/2k and 20k/4k routs into draws;
- cross-army enemy lethality or enemy health as a shield multiplier — turns section 3
  into a draw;
- self-lethality inside the shield source — collapses the section 1 threshold to
  draws;
- numerator-subtraction shielding (shield subtracted before the defensive division) —
  shield magnitude 13-150x too small to match section 1;
- dynamic crowding evaluated on current troop counts — turns section 1's 5,100/1,000
  and section 2 into draws;
- global displayed-stat halving (lethality and health) — worsens section 1
  (4,950/1,000 loss 161 -> 235 against the game's 145);
- marksman count or `sqrt(marksman)` inside the shield source — principled forms
  overshoot section 10 to an attacker win; a fractional coefficient fits one battle
  but is battle-specific;
- reducing the back line's share of the defender shield by a flat multiplier or a
  flat penetration fraction — improves the marksman battles and corrects the 2,000 inf
  + 1,000 marksman winner, but the amount required differs between battles (about 0.08
  at a 33% marksman fraction vs 0.14 at 50%), so no single value fits;
- reducing the marksman weight in the crowding (`min_army`) term — moves the marksman
  battles further from game (1,000 inf + 1,000 marksman defender survivors 4,796 ->
  4,991 against the game's 4,491), so within the simulator marksmen belong in
  `min_army` at full weight.

### 15.5 Independent mixed-share dilution candidate

The guided follow-up kept the established Gatot source magnitude, raw
post-subtraction placement, and initial formation weights. It changed only the
conversion from a normalized formation weight to the shield reservation applied
to that formation's attack:

```text
r = weight(unit) / sum(weight(all attacking formations))

applied_share =
    1                 when there is one attacking formation
    r / hypot(1, r)   when there is more than one
```

This has no fitted battle-specific coefficient. It is applied to both armies and
all battles. Because each formation is diluted independently, the reservations
sum to less than one shield when several formations attack, and unused protection
does not spill between attacks.

Current deterministic results:

| Attacker composition | Game | Current simulator |
|---|---|---|
| 1,000 inf + 1,000 lancer | Defender 4,973 in 266 | Defender 4,990 in 265 |
| 1,000 inf + 1,000 marksman | Defender 4,491 in 278 | Defender 4,564 in 272 |
| 2,000 inf + 1,000 lancer | Defender 4,338 in 545 | Defender 4,330 in 522 |
| 1,000 inf + 1,000 lancer + 1,000 marksman | Defender 3,064 in 238 | Defender 3,139 in 230 |
| 2,000 inf + 1,000 marksman | Attacker 1,281 in 907 | Attacker 1,312 in 824 |
| Section 3: 5,000 inf vs 1,000 inf + 10 lancer | Attacker 4,573 in 1,151 | Attacker 4,551 in 1,157 |

Round-two values in the two marksman threshold battles show the mechanism:

| Attacker | Attack | Pre-shield | Pre-dilution allocation | Diluted allocation | Damage bypassing |
|---|---|---:|---:|---:|---:|
| 1,000 inf + 1,000 marksman | infantry | 4.482 | 7.613 | 6.809 | 0 |
| 1,000 inf + 1,000 marksman | marksman | 8.290 | 7.613 | 6.809 | 1.481 |
| 2,000 inf + 1,000 marksman | infantry | 7.773 | 8.918 | 7.695 | 0.078 |
| 2,000 inf + 1,000 marksman | marksman | 10.153 | 6.308 | 5.828 | 4.325 |

For 1,000 infantry, the marksmen deal about 432 casualties before the front line
falls, versus about 200 under the pre-dilution implementation; the defender still
wins. With 2,000 infantry, the larger fixed army scale raises marksman damage, the
defender's shrinking infantry formation generates a progressively smaller shield,
and the feedback loop crosses the opposite threshold: the attacker wins with
approximately 312 infantry and all 1,000 marksmen.

This is a substantially better deterministic mixed-formation candidate, not a
confirmed internal game formula. The Bradley cases remain materially discrepant:
section 10 improves from 688 rounds / 2,769 defenders to 708 / 2,597, against
the game's 875 / 2,296; section 15.2 moves only slightly from 441 rounds / 641
attackers to 436 / 655, against 366 / 851. Those cases still contain independent
Bradley/application uncertainties and should not be treated as clean Gatot-only
validation.

## 16. Live emulator pressure probes

These deterministic battles were run after capturing the current minxxx and WIP
hero skill levels and displayed troop stats. The attacker has no heroes. The
defender uses Gatot `1/1/1`; therefore S2 is level 1. No game round counts were
recorded.

Attacker displayed stats:

| Type | Attack | Defense | Lethality | Health |
|---|---:|---:|---:|---:|
| Infantry | `271.7%` | `259.5%` | `208.4%` | `209.6%` |
| Marksman | `270.0%` | `265.0%` | `214.9%` | `210.0%` |

Defender infantry displayed stats:

| Attack | Defense | Lethality | Health |
|---:|---:|---:|---:|
| `483.6%` | `478.9%` | `157.5%` | `170.9%` |

Results:

| Attacker | Defender | Game survivors | Fixed-hypot simulator | Tested pressure-aware alternative |
|---|---|---:|---:|---:|
| 1,500 infantry + 1,500 marksmen | 1,000 infantry | A 2,777 / D 0 | A 2,779 / D 0 | A 2,777 / D 0 |
| 2,000 infantry + 2,000 marksmen | 1,000 infantry | A 3,809 / D 0 | A 3,810 / D 0 | A 3,809 / D 0 |
| 2,000 infantry + 2,000 marksmen | 5,000 infantry | A 396 / D 0 | A 623 / D 0 | A 472 / D 0 |
| 7,500 infantry | 5,000 infantry | A 0 / D 2,513 | A 0 / D 2,514 | A 0 / D 2,514 |

The matched 2,000 + 2,000 pair is discriminating evidence. The attacking
composition and displayed stats are unchanged, while the defender grows from
1,000 to 5,000 infantry. Fixed hypot is almost exact in the first battle but
leaves 227 too many attackers in the second. A pressure-aware interpolation was
tested and reduced that miss to 76, but the particular interpolation was not
established by an independent observation and has therefore not been retained as
the implemented rule.

## 17. Coefficient-free distribution sweep

An exploratory screen tested 1,120 shield-distribution candidates against all 25
runnable deterministic observations. It deliberately used only mechanically
recognisable inputs and powers:

- initial or current attacking-formation troop count;
- count powers `0`, `1/2`, `1`, `2`, and `3`;
- no stat term, or base/effective Attack, Lethality, `Attack × Lethality`,
  effective Defense, effective Health, or `Defense × Health`;
- stat powers `1/2`, `1`, and `2`;
- normalized shares, fixed hypot shares, hypot with the unallocated remainder
  assigned to infantry, or hypot shares renormalized to sum to one.

The combination `sqrt(current troops) × effective Attack × effective
Lethality` was included; for formations hitting the same target, this is the
variable numerator of their ordinary pre-shield damage rather than merely an
Attack-stat proxy.

The acceptance test was the same as the evidence runner. The “core” count below
excludes section 10 (Bradley) and section 15.2 (secondary heroes), because those
contain independent application uncertainties. This leaves 23 cleaner
deterministic observations.

| Rule | Core failures | All failures | Winner mismatches |
|---|---:|---:|---:|
| Implemented fixed hypot | 5 / 23 | 7 / 25 | 0 |
| Fixed hypot, remainder assigned to infantry | 4 / 23 | 6 / 25 | 0 |
| `sqrt(current troops) × sqrt(effective Defense)`, normalized | 3 / 23 | 5 / 25 | 0 |
| Same weights, hypot remainder assigned to infantry | 3 / 23 | 5 / 25 | 0 |
| `sqrt(initial troops) × sqrt(effective Defense)`, renormalized hypot | 3 / 23 | 5 / 25 | 0 |
| `sqrt(current troops) × sqrt(effective Health)`, renormalized hypot | 3 / 23 | 5 / 25 | 0 |

No screened rule had fewer than three core failures while also preserving every
winner. In particular, none reproduced both decisive section 15.3 marksman
battles within the survivor and round tolerances.

Selected outcomes show why the infantry-remainder adjustment is useful but not
sufficient:

| Observation | Game | Fixed hypot | Remainder to infantry | Best-ranked screen result |
|---|---:|---:|---:|---:|
| 1,000 infantry + 1,000 marksmen vs 5,000 infantry | D 4,491 @ 278 | D 4,564 @ 272 | D 4,564 @ 272 | D 4,661 @ 273 |
| 2,000 infantry + 1,000 marksmen vs 5,000 infantry | A 1,281 @ 907 | A 1,312 @ 824 | A 1,302 @ 829 | A 1,717 @ 780 |
| 2,000 infantry + 2,000 marksmen vs 5,000 infantry | A 396 | A 623 | A 456 | A 376 |

The remainder rule leaves the first marksman case unchanged, modestly improves
the second, and reduces the new emulator miss from 227 survivors to 60. This is
consistent with much of the additional infantry allocation being unused when
the infantry attack is already smaller than its assigned shield.

The best numerical candidates were driven by the attacking formation's Defense
or Health, while Attack, Lethality, and `Attack × Lethality` candidates did not
produce a credible improvement. Defense/Health may be proxying for troop type,
but making Gatot's shield allocation depend on an enemy formation's defensive
stats has no independent mechanical support, so these candidates have not been
adopted.

The strongest candidates were also run over all 28 runnable stochastic
observations with three paired replicates. Every candidate produced identical
results: the stochastic Gatot observations contain only one incoming formation,
where every distribution rule assigns the full shield, while the section 9
lancer observations do not contain Gatot. More replicates therefore cannot
distinguish these distribution candidates.

### Extended allocation-function screen

A second two-stage screen retained the same 280 weight recipes but expanded the
allocation functions. It first evaluated 6,720 combinations on the four most
discriminating mixed cases, then ran the best five weight recipes for every
allocation function, plus the global leaders, against all 25 deterministic
observations.

The pointwise functions were linear, softsign, `1 - exp(-r)`, hypot, `tanh(r)`,
the cubic norm `r / cbrt(1 + r^3)`, `atan(r)`, and `log(1 + r)`. Each nonlinear
function was tested raw, renormalized to sum to one, and with its unused
remainder assigned to infantry.

It also tested cross-formation norm and concentration rules:

```text
L2:                   share_i = r_i / sqrt(sum(r_j^2))
L3:                   share_i = r_i / cbrt(sum(r_j^3))
sqrt concentration:   share_i = r_i * sqrt(sum(r_j^2))
concentration:        share_i = r_i * sum(r_j^2)
power normalized 2:   share_i = r_i^2 / sum(r_j^2)
power normalized 3:   share_i = r_i^3 / sum(r_j^3)
```

Here `1 / sum(r_j^2)` is the inverse Simpson concentration, or effective number
of formations. The first two rules force the squared or cubed applied shares to
sum to one; the next two reduce total application as formations become more
evenly distributed; the final two preserve one full shield while concentrating
it toward the largest weight.

| Candidate | All failures | Winner mismatches | Selected decisive results |
|---|---:|---:|---|
| Implemented fixed hypot | 7 / 25 | 0 | 1k+1k marks: D 4,564 @ 272; 2k+1k marks: A 1,312 @ 824; emulator hard case: A 623 |
| Fixed hypot, remainder to infantry | 6 / 25 | 0 | D 4,564 @ 272; A 1,302 @ 829; A 456 |
| Raw `log(1+r)`, approximately `sqrt(current troops)` weights | 4 / 25 | 0 | D 4,618 @ 274; A 2,023 @ 660; A 644 |
| Raw cubic norm, `sqrt(current troops) * sqrt(effective Defense)` weights | 4 / 25 | 0 | D 4,610 @ 274; A 1,764 @ 763; A 435 |
| Same cubic weights, remainder to infantry | 4 / 25 | 0 | D 4,610 @ 274; A 1,761 @ 769; A 376 |
| Best L2 normalization | 6 / 25 | 2 | D 4,373 @ 281; defender wins with 1,478 @ 851; A 304 |
| Best L3 normalization | 6 / 25 | 2 | D 4,373 @ 281; defender wins with 1,555 @ 843; A 301 |
| Best inverse-Simpson-derived bounded rule | 5 / 25 | 0 | D 4,458 @ 278; A 2,334 @ 545; A 758 |

The four-failure candidates improve the threshold count, but neither reconciles
the decisive 2,000 infantry + 1,000 marksmen case: the game has 1,281 attackers
at round 907, while the logarithmic and cubic candidates leave 2,023 at round
660 and 1,764 at round 763 respectively. The cubic remainder rule fits the new
emulator hard case well but still misses that older duration/survivor anchor.

L2/L3 normalization is particularly inconsistent with the evidence. With two
equal formations, L2 applies `0.707` shield to each attack, totalling `1.414`
shield applications; its best screened candidates reverse two recorded winners.
The concentration and power-normalized variants also fail to improve the
cross-case result.

The mechanically direct damage-scaling interpretation was then tested
separately, rather than relying on whichever L2 weight happened to score best:

```text
share_i = sqrt(formation troops_i) / sqrt(sum(all formation troops))
```

This mirrors the ordinary damage army term: splitting 2,000 otherwise identical
troops into two 1,000-troop formations changes the combined term from
`sqrt(2000)` to `2 * sqrt(1000)`, a factor of `sqrt(2)`, and the proposed shield
shares likewise sum to `sqrt(2)`. Initial-count, current-count, exact ceiled army
term, and effective-damage-numerator variants were run.

The direct interpretation is too strong. The initial-count version has seven
threshold failures and reverses three recorded winners. It predicts 4,988
defenders at round 262 for the 1,000 infantry + 1,000 marksmen case, 4,065
defenders at round 532 for the 2,000 infantry + 1,000 marksmen case, and 313
defenders for the new 2,000 + 2,000 emulator case. The corresponding game
results are 4,491 defenders at round 278, 1,281 attacking survivors at round
907, and 396 attacking survivors. Current-count and damage-numerator versions
are still more protective. Therefore the observed formation damage
amplification is real, but Gatot's offset cannot receive the full matching L2
amplification under the current shield-magnitude formula.

The screen narrows the next question rather than solving it: a simple static
formation weight is not enough to reconcile the section 15.3 duration flip.
Further discrimination needs either round-by-round live evidence or candidates
that change how shield is consumed or carried between attacks, rather than
another fitted static weight.

## 18. Per-turn shield-pool and carry experiments

Two mechanically distinct consumption candidates were implemented behind a
temporary simulation option, tested against the complete evidence inventory,
and then removed. The production implementation remained the fixed-hypot rule
throughout.

The candidates were:

1. **Shared pool:** each turn starts with one full Gatot shield. Incoming normal
   and skill hits consume that capacity in battle-job order, and unused capacity
   carries to the next hit in the same turn.
2. **Fixed-hypot carry:** each normal attacking formation unlocks only its
   existing fixed-hypot reservation. Any part not absorbed by that hit carries
   forward to the next hit in the same turn. Skill hits can consume carried
   capacity but do not unlock another reservation.

Both candidates used only existing battle quantities: the calculated Gatot
shield, the established fixed formation reservations, the pre-offset damage of
each job, and turn boundaries. Neither introduced a fitted coefficient.

The full evidence command used 100 replicates for each stochastic observation:

```text
cd simulator
npx --yes tsx src/tooling/gatotEvidence.ts --replicates 100
```

The same runner was executed with each temporary candidate selected. Results:

| Case | Game | Fixed hypot | Shared pool | Fixed-hypot carry |
|---|---|---|---|---|
| Section 3: 5,000 inf vs 1,000 inf + 10 lancer | A 4,573 @ 1,151 | A 4,551 @ 1,157 | A 4,996 @ 1,037 | A 4,996 @ 1,037 |
| Section 15.3: 1,000 inf + 1,000 marks vs 5,000 inf | D 4,491 @ 278 | D 4,564 @ 272 | D 4,988 @ 262 | D 4,984 @ 262 |
| Section 15.3: 2,000 inf + 1,000 marks vs 5,000 inf | A 1,281 @ 907 | A 1,312 @ 824 | **D 4,023 @ 560** | **D 1,317 @ 771** |
| Section 16: 2,000 inf + 2,000 marks vs 1,000 inf | A 3,809 | A 3,810 | A 3,809 | A 3,810 |
| Section 16: 2,000 inf + 2,000 marks vs 5,000 inf | A 396 | A 623 | A 376 | A 621 |

Corpus summaries:

| Candidate | Deterministic OK | Deterministic not OK | Total OK | Total not OK | Not assessed |
|---|---:|---:|---:|---:|---:|
| Fixed hypot | 18 | 7 | 42 | 11 | 2 |
| Shared pool | 18 | 7 | 42 | 11 | 2 |
| Fixed-hypot carry | 17 | 8 | 41 | 12 | 2 |

The shared pool is strongly supported by the isolated section-16 pressure pair:
it is exact for the 1,000-defender case and misses the 5,000-defender case by
only 20 attackers instead of 227. It is nevertheless rejected as a global
mechanic because it breaks the established tiny-lancer distribution case,
grossly overprotects Gatot in several section-15 mixed battles, and reverses the
recorded 2,000-infantry + 1,000-marksman winner.

Fixed-hypot carry is also rejected. It does not materially change the hard
section-16 result because the early infantry hit exhausts its reservation there,
while it still overprotects the shield holder in section 3 and reverses the
decisive section-15 winner.

These results establish that neither a single fungible turn pool nor simple
unused-reservation carry can be the global rule. The section-16 pressure effect
is real, but any viable candidate must depend on something that differs across
defensive pressure without granting the same extra protection in the older
mixed-formation family. The matched 2,000/3,000/4,000 defender-pressure captures
requested in [WOS-462](/WOS/issues/WOS-462) are the next discriminating evidence.

## 19. Displayed-stat rounding bound for the matched pressure pair

The section-16 mismatch is not explained by the displayed stats being rounded to
one decimal place.

The two matched 2,000-infantry + 2,000-marksman battles share twelve displayed
stat inputs:

- attacker infantry Attack, Defense, Lethality, and Health;
- attacker marksman Attack, Defense, Lethality, and Health;
- defender infantry Attack, Defense, Lethality, and Health.

Each value was independently moved to both endpoints of its one-decimal display
interval (`displayed − 0.05` and `displayed + 0.05`). All `2^12 = 4,096`
combinations were run against both the 1,000- and 5,000-defender observations,
using the same underlying endpoint choice in both matched battles.

| Result | 1,000 defenders | 5,000 defenders |
|---|---:|---:|
| Game attacker survivors | 3,809 | 396 |
| Unadjusted simulator | 3,810 | 623 |
| Exhaustive endpoint range | 3,810–3,811 | 612–631 |
| 10,000 deterministic interior samples | 3,810–3,811 | 614–629 |
| Best joint endpoint | 3,810 | 612 |

The best hard-case endpoint is the mechanically favourable corner where every
attacker stat is `−0.05` and every defender stat is `+0.05`. It still leaves 216
too many attackers. The existing testcase runner's one-axis rounding correction
finds the same hard-case minimum of 612.

One-at-a-time sensitivity also shows why the easy observation is stable. Every
single endpoint perturbation leaves it at 3,810 survivors. In the hard battle,
the largest individual movements come from marksman Lethality and defender
Health, and each moves the result by only about three troops from the 623
baseline.

The endpoint screen was supplemented with 10,000 deterministic interior samples
(LCG seed `460`); none escaped the endpoint range. Together with the narrow
one-at-a-time sensitivities and the testcase runner's directional scan, this
rules out displayed-stat rounding as a credible route from 623 to 396. Future
Gatot hypotheses should treat the matched pressure discrepancy as a mechanic or
observation question, not consume more time tuning rounded report inputs.

## 20. Current modified Attack as the S2 source basis

Gatot S2 says its protection is equal to Infantry Attack multiplied by the
configured percentage. A mechanically direct interpretation is that “Attack”
means the formation's current modified Attack, including live Attack-up and
Attack-down effects, rather than the current implementation's base troop Attack
plus player Attack bonus only.

This was tested as a temporary global candidate. For every Gatot activation, the
existing source basis was additionally multiplied by the applicable live
`active.hero.attack.up` and `active.troop.attack.up` factors and divided by the
applicable `active.hero.attack.down` and `active.troop.attack.down` factors. The
same-effect `add|max` behavior was respected. No coefficient, battle-specific
condition, damage-equation change, or configured skill value was introduced.

The complete evidence runner was executed for the production baseline and the
temporary candidate with 100 replicates per stochastic observation:

```text
cd simulator
npx --yes tsx src/tooling/gatotEvidence.ts --replicates 100
```

| Corpus result | Production basis | Current-modified-Attack basis |
|---|---:|---:|
| Deterministic OK | 18 | 5 |
| Deterministic not OK | 7 | 20 |
| Stochastic OK | 24 | 19 |
| Stochastic not OK | 4 | 9 |
| Total OK / not OK / not assessed | 42 / 11 / 2 | 24 / 29 / 2 |

The deterministic threshold series rejects the candidate particularly strongly.
Royal Legion already supplies asymmetric live Attack reductions in those
Gatot-vs-Gatot battles. Feeding those modifiers back into each side's next-turn
shield moved every recorded section-1 result outside tolerance:

| Section-1 case | Game | Production basis | Current-modified-Attack basis |
|---|---|---|---|
| 4,900 vs 1,000 | Draw at 1,500 | Draw at 1,500 | Attacker at 689 |
| 4,950 vs 1,000 | Draw at 1,500 | Draw at 1,500 | Attacker at 674 |
| 5,000 vs 1,000 | Draw at 1,500 | Draw at 1,500 | Attacker at 661 |
| 5,050 vs 1,000 | Draw at 1,500 | Draw at 1,500 | Attacker at 649 |
| 5,100 vs 1,000 | Attacker at 1,381 | Attacker at 1,380 | Attacker at 637 |

The section-3 tiny-lancer battle also moved from attacker `4,551` at round
`1,157`, close to the game result `4,573` at round `1,151`, to attacker `4,703`
at round `638`. The decisive section-15.3 `2,000 infantry + 1,000 marksman`
observation reversed from the correct attacker winner to a defender win.

The section-16 pressure cases were unchanged. Their defender has Gatot S2 level
1, but the hero-less attacker supplies no live Attack-down effect against the
defender's shield source. The hard `2,000 infantry + 2,000 marksman` versus
`5,000 infantry` case therefore remained at `623` simulated attacker survivors
against `396` in the game.

The candidate is rejected and the temporary implementation was removed. Gatot
S2's source Attack should continue to exclude live Attack up/down effects unless
future independent evidence directly contradicts the threshold series. This
also rules out runtime Attack feedback as an explanation for the section-16
pressure discrepancy.

## 21. Whole-casualty shield quantization

The raw Gatot shield is normally retained as a fractional value. A separate
coefficient-free screen tested whether the game first quantizes each newly
created shield to a whole-casualty capacity. The candidate applied `floor`,
nearest-integer `round`, or `ceil` consistently to the complete S2 shield at
activation, before any mixed-formation share was applied. The configured S2
percentage, source basis, duration, distribution, and damage equation were
unchanged.

Each candidate used the full evidence runner with 100 replicates per stochastic
observation:

```text
cd simulator
npx --yes tsx src/tooling/gatotEvidence.ts --replicates 100
```

| Corpus result | Fractional production | Floor | Nearest | Ceiling |
|---|---:|---:|---:|---:|
| Deterministic OK | 18 | 4 | 8 | 7 |
| Deterministic not OK | 7 | 21 | 17 | 18 |
| Stochastic OK | 24 | 12 | 11 | 10 |
| Stochastic not OK | 4 | 16 | 17 | 18 |
| Total OK / not OK / not assessed | 42 / 11 / 2 | 16 / 37 / 2 | 19 / 34 / 2 | 17 / 36 / 2 |

Flooring makes Gatot materially too weak: section 1's `4,900 vs 1,000` draw
becomes an attacker win at round `793`, the section-3 tiny-lancer battle finishes
at round `707` instead of the game's `1,151`, and the hard section-16 pressure
case worsens from `623` to `852` attacker survivors.

Nearest and ceiling rounding make the shield too strong at critical thresholds.
Both turn section 1's `5,100 vs 1,000` attacker win at round `1,381` into a draw
with `996` defenders. Nearest moves the section-3 result to attacker `4,478` at
round `1,352`; ceiling prevents the attacker from winning that battle at all.
Ceiling also moves the decisive section-15.3 `2,000 infantry + 1,000 marksman`
case from attacker `1,312` to attacker `2,241`, against the game's `1,281`.

Ceiling happens to move the unresolved section-16 hard case from `623` to `369`
attacker survivors, close to the game's `396`. That single improvement cannot
support the mechanic because the same global rule destroys the established
threshold, distribution, and stochastic corpus. It is an example of why the
matched pressure result cannot be fitted in isolation.

All three whole-casualty quantization candidates are rejected and the temporary
switch was removed. Gatot's raw shield should remain fractional through
activation and formation allocation under the current evidence.

## 22. Activation and expiry timing screen

The production duration (`delay: 1`, `count: 1`) schedules each attack-created
shield for exactly the following round. Four global timing variants were tested
without changing the S2 percentage, source basis, mixed-formation allocation,
post-subtraction placement, or ordinary damage equation:

1. `delay: 0`, `count: 1`: active for the remainder of the creation round only.
2. `delay: 0`, `count: 2`: active for the remainder of the creation round and
   the following round.
3. `delay: 1`, `count: 2`: active for the following two rounds.
4. `delay: 2`, `count: 1`: active for one round after an additional round of lag.

Each candidate used the complete evidence runner with 100 replicates per
stochastic observation:

```text
cd simulator
npx --yes tsx src/tooling/gatotEvidence.ts --replicates 100
```

| Timing | Deterministic OK / not OK | Stochastic OK / not OK | Total OK / not OK / not assessed |
|---|---:|---:|---:|
| Production: next round only | 18 / 7 | 24 / 4 | 42 / 11 / 2 |
| Creation-round remainder only | 3 / 22 | 6 / 22 | 9 / 44 / 2 |
| Creation-round remainder + next round | 19 / 6 | 21 / 7 | 40 / 13 / 2 |
| Following two rounds | 19 / 6 | 24 / 4 | 43 / 10 / 2 |
| One round with two-round lag | 13 / 12 | 21 / 7 | 34 / 19 / 2 |

Immediate-only activation is strongly rejected. Because Gatot's shield is
materialized after its source attack, this variant can affect only later damage
jobs in that same round and expires before the next round. It breaks every
section-1 threshold case, every section-2 Health case, the section-3 tiny-lancer
case, and most stochastic observations.

Keeping the immediate shield through the next round recovers the deterministic
threshold family but adds three stochastic failures. Delaying activation by an
extra round also weakens the established threshold behavior: deterministic
passes fall from 18 to 13, including a winner mismatch in the section-2 Health
series.

Retaining each shield for two full future rounds changes very little because
the skill activates every round and same-effect `max` stacking selects one of
the overlapping copies. It turns only the marginal section-15.3
`1,000 infantry + 1,000 marksman` round-tolerance result from fail to pass
(`272` to `273` simulator rounds against `278` game rounds; tolerance `5.6`).
It does not resolve the decisive `2,000 infantry + 1,000 marksman` duration
miss (`825` simulator rounds against `907`), and moves the section-16 hard
pressure result only from `623` to `617` attacker survivors against `396`.
The two-round persistence also conflicts with the skill's explicit “for 1
turn” wording, so the single marginal threshold improvement is not sufficient
evidence to adopt it.

All timing variants are rejected and were removed. The production
`delay: 1`, `count: 1` duration remains the best-supported interpretation:
Gatot creates the shield after attacking, it applies throughout the next round,
and it expires before the following round.

## 23. Initial source-count snapshot

The production S2 magnitude uses the source infantry formation's current
round-start troop count. A coefficient-free alternative tested whether the
count component is snapshotted from the formation's initial troop count for the
whole battle:

```text
production source = sqrt(ceil(current source infantry)) * Attack / Health
candidate source  = sqrt(initial source infantry) * Attack / Health
```

This changed no configured S2 value, stat term, shield allocation, duration,
post-subtraction placement, or ordinary damage term. The full evidence runner
was again executed with 100 replicates per stochastic observation.

| Source-count rule | Deterministic OK / not OK | Stochastic OK / not OK | Total OK / not OK / not assessed |
|---|---:|---:|---:|
| Production current count | 18 / 7 | 24 / 4 | 42 / 11 / 2 |
| Initial count snapshot | 6 / 19 | 19 / 9 | 25 / 28 / 2 |

The initial snapshot moves the section-16 hard pressure case past the game
result in the expected direction: simulated attacker survivors fall from `623`
to `136`, while the game has `396`. That directional response confirms that
shield decay with source casualties materially controls this pressure case,
but a fixed initial snapshot is far too protective globally.

The candidate breaks the established threshold behavior. Section 1's
`5,100 vs 1,000` attacker win becomes a draw, the `10,000 vs 2,000` duration
misses by `283` rounds, and the section-3 tiny-lancer attacker win becomes a
draw. It also worsens the decisive section-15.3 `2,000 infantry + 1,000
marksman` result from `1,312` attackers at round `824` to `2,262` at round
`1,153`, against `1,281` at round `907` in the game.

The initial-count snapshot is rejected and the temporary implementation was
removed. The result rules out a battle-long fixed source count. It also shows
that interpolating between current and initial count could fit the isolated
section-16 endpoint, but such an interpolation would require a separately
supported mechanic rather than a fitted exponent or coefficient.

## 24. Normal-versus-skill damage-job shield reservation

The production implementation gives every applicable `DamageJob` an independent
fixed-hypot Gatot reservation. A normal job and each genuine
`extra_skill_attack` job therefore receive the same formation share of the turn
shield independently. Section 18 tested the carry endpoint of a
source-formation/turn alternative: a normal job unlocked one fixed-hypot
reservation and any unused capacity could carry into later jobs. That candidate
was rejected globally.

This follow-up tested the remaining no-carry endpoint:

1. **Independent per job (production):** every normal or genuine skill job gets
   the source formation's fixed-hypot reservation.
2. **Source formation per turn, no carry:** the reservation belongs to the
   source formation's normal job. Genuine skill jobs do not receive another
   reservation, and unused protection from the normal job is not carried.
3. **Source formation per turn, unused carry:** the section-18 fixed-hypot carry
   candidate, retained here as the other bounded endpoint of the family.

The no-carry candidate changed only whether `kind: "skill"` jobs received the
turn-shield share. It did not change the configured S2 values
`[6, 12, 18, 24, 30]`, source magnitude, duration, formation weights,
post-subtraction placement, ordinary damage equation, or any coefficient.

Both production and the temporary no-carry candidate were run across the
complete evidence inventory with 100 replicates per stochastic observation:

```text
cd simulator
npx --yes tsx src/tooling/gatotEvidence.ts --replicates 100
```

| Reservation rule | Deterministic OK / not OK | Stochastic OK / not OK | Total OK / not OK / not assessed |
|---|---:|---:|---:|
| Independent per job (production) | 18 / 7 | 24 / 4 | 42 / 11 / 2 |
| Source formation per turn, no carry | 18 / 7 | 24 / 4 | 42 / 11 / 2 |
| Source formation per turn, unused carry (section 18) | 17 / 8 | 24 / 4 | 41 / 12 / 2 |

The complete rendered production and no-carry reports were byte-for-byte
identical. The current game-observation inventory therefore does not contain a
case that can distinguish whether a Gatot turn shield independently protects a
genuine skill job.

The existing synthetic trace fixture does distinguish the semantics. Under
production, its round-two incoming normal and linked genuine skill jobs both
record the same shield offset. Under the no-carry candidate, the normal job
keeps the offset and the skill job records no shield; the focused assertion
`deferred shields use finalized normal plus linked skill kills and reapply to
every hit next turn` fails at the missing skill-job shield. This confirms that
the candidate was active and that the corpus equality was caused by absent
discriminating evidence, not by an inert code path.

No member of this family justifies a production change:

- the no-carry rule is observationally tied with production on the full live
  corpus;
- the unused-carry rule is already rejected by section 18 because it breaks the
  tiny-lancer distribution case and reverses the decisive section-15 winner;
- the synthetic fixture specifies current simulator behavior but is not game
  evidence.

The temporary no-carry code was removed. Production remains independent
fixed-hypot reservation per normal and genuine skill damage job. A future live
fixture must combine Gatot with a reliably triggered genuine
`extra_skill_attack` and report enough paired controls to isolate whether the
skill job receives a second shield reservation; until then this interaction
remains unresolved rather than fitted.
