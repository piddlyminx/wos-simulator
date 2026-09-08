# Gatot: fractional state and full attack strength — 2026-09-07

The simulator preserves the two separate behaviors Paul described:

- Remaining troop state carries fractional casualties between rounds: `commitRound` subtracts the summed floating losses without rounding (`simulator/src/simulator.ts:553`).
- Damage uses the ceiling of positive surviving troops (`simulator/src/damage.ts:129`). Gatot's shield source also counts a partially damaged surviving troop as one (`simulator/src/simulator.ts:372`).

Paul supplied an additional in-game observation during this audit: **the same single Infantry does not lose attack power as it is worn down**. This is dated user-supplied evidence supporting the inner attack-count ceiling. No numeric per-attack game measurements were supplied. Neither rule was changed or reopened in this audit.

The production change removes only the outer ceiling around `sqrt(ceiled source troops) * sqrt(smaller initial army)` (`simulator/src/damage.ts:134`). Final displayed survivor counts are ceiled separately (`simulator/src/simulator.ts:613`); that does not round the stored battle state.

## Accepted fixture corroboration

Both examples use exactly `infantry_t1_fc10:1`, Gatot5/5/5, against nohero T9 Marksmen. Defender report stats are2159.6 Attack /2185.6 Defense /1942.2 Lethality /2139.7 Health; attacker stats are208.8 /207.1 /158.8 /164.7. These are report-resolved values; no hero-generation stats were added. FC10 troop effects remain active, including stochastic CrystalShield, so individual simulated trajectories are illustrations rather than observed round counts.

| Fixture key | Game remaining: attacker / defender | New-engine64-seed attacker range | Simulated Infantry deaths |
|---|---|---|---|
| `testcases/gatot_verified/s8-20000-t9-marksmen-vs-one-t1-fc10-infantry.json::0` |19943 /0|19895–19976|64/64|
| `testcases/gatot_verified/s8-12000-t9-marksmen-vs-one-t1-fc10-infantry.json::0` |11791 /0|11779–11899|64/64|

The20000 case's observation occurs exactly once in the64 new-engine draws, with28 draws below and35 above. The12000 result is toward the lower end, with3 draws below it. This small sample corroborates plausibility; it is not a full distribution-equivalence test.

For the preselected seed0 in the20000 case, the new engine stores Infantry state1 →0.923787 after round1 →0.872591 after round3, eventually reaching0 in round220. No incoming round exceeds0.076213 raw kills. In the12000 example, the state falls from1 to0.940966 after round1 and eventually from0.001226 to0 in round834; no incoming round exceeds0.059035 raw kills. These are simulator measurements, not invented game attack measurements. They illustrate accumulation of sub-one casualties; ceiling the stored single-Infantry state each round would discard that accumulated wear.

In both seed0 traces, the Infantry's outgoing normal damage stays exactly0.187331159 and its damage army term stays1 throughout the attrition. This matches the distinction in Paul's qualitative observation: fractional survival state does not imply fractional attack strength.

## What the rounding change preserves

Both isolated engines retain fractional state and the inner attack-count ceiling. Original/new seed0 death rounds are200/220 in the20000 case and791/834 in the12000 case; the trajectories are **not numerically identical** because the outer ceiling affects damage crossing the shield. Both engines kill the Infantry in every one of the64 sampled runs for each example. There is no per-round state rounding in either engine.

One existing threshold question remains visible: `s8-11548-t9-marksmen-vs-one-t1-fc10-infantry.json::0` reports11268 attackers and1 defender surviving, while both old and new64-seed samples eliminated the Infantry. A bounded sample does not settle that stochastic tail or battle-duration question. This predates the outer-ceiling change and does not challenge the established inner-ceiling observation.

General model predictions were stated before opening these outcomes. Inputs were then read with outcomes redacted and a64-seed comparison frozen for16 matching fixtures; accepted outcomes were opened afterward. Earlier inventory work may already have exposed some endpoints, so this is retrospective corroboration, not a new blinded trial.

The compact machine-readable evidence, complete selected fractional-state trajectories and dated user observation are in `gatot-fractional-state.json`. Scratch inputs, prediction script, pre-outcome output and comparison are under `tmp/mechanics-audit-2026-09-07/gatot-fractional-state/`. The original and no-outer source copies remain under sibling `nohero-mixed/runtimes/`. No production or emulator actions were taken for this audit.
