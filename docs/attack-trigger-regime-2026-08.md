# Attack-trigger regime results (2026-08-08)

This document records simulator choices and evidence. It does not claim that unresolved behavior is confirmed game truth.

## Implemented runtime contract

- A normal attack is resolved procedurally: lock target, reject same-round exhaustion, reject a pre-existing `no_attack`, run attack cadence, resolve a dodge created by that declaration, run type-less carriers, resolve normal damage if not dodged, then run extra attacks and deferred consequences.
- Normal attacks execute troop-major within a round: attacker infantry, defender infantry, attacker Lancer, defender Lancer, attacker Marksman, defender Marksman. Each side retains its own order index for target-order effects.
- Cadence counters belong to `(side, troop type)` and count actual normal attacks only. Dodge counts. `no_attack`, exhausted-target skips, and extra skill jobs do not.
- Dodge is a zero-kill normal outcome (`dodged: true`), not a cancellation. It has no damage equation, but attack triggers, nested children, and extra attacks continue.
- Turn triggers have no source or target. Their effects use concrete scopes; one broad turn-scoped effect can participate in every matching normal attack during its active window.
- Effects may contain keyed `trigger_effects`. Typed parents materialize children only when their primary mechanic is actually used. A type-less parent is a bounded normal-attack carrier. Carrier children use `parent.use.source` and `parent.use.target` and cannot affect the same damage job that caused their creation. A directly attack-triggered dodge is different: it is evaluated immediately after the declaration and can dodge that attack.
- Duration-only charging on dodge or `no_attack` expires attack-limited effects without pretending their primary mechanic was used; it does not materialize children.

## Config migrations

- Gordon `VenomInfusion`, Gwen `AirDominance`, and Xura `PiercingArrow` use actual per-unit normal-attack cadence. Air Dominance therefore fires independently for each troop type on attacks 5, 11, 17, ... .
- Blanchette `BloodHunter`, Sonya `TorrentialImpact`, Wayne `ThunderStrike`, and Ahmose `ViperFormation` use source-less turn cadence with fixed effect scopes. Thunder Strike uses one broad one-turn extra-attack effect, which naturally serves every eligible normal troop attack without matching skill jobs.
- Sonya's Torrential stun is nested under the extra attack. If the parent emits no job because the locked target is already exhausted, no stun is created. The stun starts next round and prevents the struck troop line's next attack regardless of which troop line it would target. `BountyTemptation/2` also starts next round.
- Existing one-round delays for Gordon `VenomInfusion/2`, Norah `Momentum`, Greg `DeterrenceOfLaw`, and Xura `PiercingArrow/2` are retained. Ahmose `BladeOfLight/2` and Magnus `IronPhalanx/1` also begin next round so persistent consequences of an attack cannot alter a later normal-attack cluster in the round that created them.

## Renee cadence comparison

The initial comparison considered two candidates while retaining the then-current effect model:

1. actual-attack candidate: every second successful normal Lancer attack applies target-locked typed effects to that attack;
2. strict-turn candidate: every second turn creates a one-turn, one-use Lancer carrier, which expires unused if no eligible Lancer attack occurs.

The focused no-seed testcase corpus was identical for both candidates: 2 run, 0 failed, 0 improved, 1 worse, average signed error -0.34%. Those cases contained no pause/exhaustion distinction, so they did not choose between the candidates.

Subsequent Renee work selected the strict-turn model now present in the live configuration: every second turn creates one-use Lancer carriers, and their children apply `active.hero.damageTaken.up` to the troop line hit by that Lancer attack. The children start next turn. Nightmare Trace and Dreamcatcher remain source-locked to Lancer damage; Dreamslice permits damage from any friendly troop. This supersedes the initial implementation choice above, but the lifecycle remains an evidence-backed model rather than a universal statement about every possible blocked/exhausted case.

## Round outer-loop comparison (2026-08-13)

The previous serial implementation was side-major: all three attacker troop lines, then all three defender troop lines. This was inherited from the old intent builder; no game observation or discriminator was found that originally selected it.

A troop-major counterfactual was run over the current 289-case testcase corpus. Of the 289 case means, 280 were identical. The other nine were stochastic cases whose random-number assignment changed with execution order; no deterministic endpoint changed and no pass/fail result changed. Troop-major was closer to the game mean in six of those rows, side-major in three, but that is not causal evidence for either order.

The implementation now uses troop-major alternating sides because it is the simpler representation of paired troop exchanges within a round. This is an explicit structural choice, not verified game truth. Ahmose `BladeOfLight/2` and Magnus `IronPhalanx/1` were subsequently moved to next-round activation, eliminating the same-round windows identified for those modifiers. The current target-reactive effects—Swift Jive, Crystal Shield, and Incandescent Field—are locked to the attack that triggered them. No current deterministic cross-side discriminator has been found; the shared RNG stream can still assign stochastic rolls differently between the two orders. A future same-round cross-side effect, or a game trace exposing declaration order, is needed to confirm the choice.

## Full roster pass (2026-08-13)

All 39 hero definition files were exercised for 20 rounds with all three T6 troop lines, at level 5, on both rally and garrison sides. Every configured combat skill produced a matching activation or effect. The zero-effect cases were the intentional `NonCombatPlaceholder` entries and Zinman's Bastionist, whose current definition is descriptive rather than a combat modifier. No unsupported runtime effect type appeared.

A second, slot-by-slot lifecycle audit covered all 109 configured S1-S3 slots. Twenty-eight skills are attack-triggered, containing 37 effects:

- three one-attack modifiers apply to the triggering normal job: Ahmose `BladeOfLight/1`, Bahiti `Fluorescence/1`, and Gordon `VenomInfusion/1`;
- eighteen `extra_skill_attack` effects execute as jobs linked to the triggering cluster;
- Reina `SwiftJive/1` is the sole target-reactive hero effect and is locked to the triggering source and target;
- fourteen effects have `turns.delay: 1` and begin next round;
- Lynn `OonaiCadenza/1` is the one explicit exception to bounded current-job duration: it applies to the triggering Marksman attack and deliberately remains as a permanent stack.

This is a dated configuration audit, not an engine-test contract: hero configuration is expected to change. Generic engine tests cover selectors, bounded immediate effects, reactive dodge timing, and next-round delay behavior without asserting how a named hero must be configured. The remaining 81 configured S1-S3 skills are battle-start, turn-start, or pre-battle skills and do not enter the attack-declaration path.

The FC10 troop-skill set was exercised separately. Every skill activated in the broad probe except Incandescent Field, because infantry remained the normal target in that formation; a focused Lancer-target probe confirmed its trigger and normal-job scope. Volley's current `active.troop.damage.up` representation was retained: repository history shows it was deliberately changed from an explicit extra-skill job, and the present evidence does not justify reversing that model during a loop audit.

Two concrete serial-flow defects were found and fixed:

- Reina's Swift Jive now rolls on an incoming normal-attack declaration and dodges that same attack. Previously its dodge was created too late and was banked for a later attack.
- Sonya's Torrential Impact stun now applies to the struck troop line independently of that line's next target. Previously its `applies_vs` lock meant the stunned line usually attacked normally.

Several description-to-scope questions were deliberately left open rather than silently broadened: Alonso Iron Strength and Greg Deterrence of Law target-line scope, Xura Piercing Arrow's Marksman source lock, Gwen Air Dominance's 5/11/17 per-line cadence, and Volley's damage-buff job shape. These are longstanding or deliberately introduced models, not mechanical breakage demonstrated by the new loop; each needs a discriminator before changing it.

## Verification ledger

Confirmed in synthetic engine tests:

- source-scoped 5/11/17 cadence for infantry, Lancer, and Marksman independently;
- extra jobs do not alter cadence and carry no cadence counter deltas;
- exhaustion and `no_attack` suppress attack triggers and counters;
- dodge preserves triggers/extras and produces no damage trace;
- a directly attack-triggered dodge applies to the normal attack that triggered it;
- one broad turn-scoped extra-attack effect serves every matching normal attack without recursively matching generated skill jobs;
- a typed parent's child appears after actual use, never on the consuming job;
- a one-turn carrier expires unused.

Still unresolved as game truth:

- the exact blocked/exhausted lifecycle boundaries of Renee's selected strict-turn carrier model;
- whether dodge should count as a hit for every hero consequence (the simulator currently treats it as an attack but zero normal damage);
- Blanchette's exact cadence wording;
- Sonya stun timing beyond the initial next-round interpretation;
- whether Ahmose's pause and protection share exactly the same in-game phase ordering;
- whether troop-major or side-major is the game's within-round outer loop.

## Performance evidence

The exact pre-change tournament command was rerun before implementation and took 66.69 seconds wall time on this machine, versus the earlier recorded 56.447-second absolute gate. Before runtime optimization, a controlled adjacent pair in an isolated detached baseline worktree took 69.83 seconds for the baseline and 74.02 seconds for the candidate; total user CPU was 962.58 versus 1012.20 seconds. That established a real refactor regression.

CPU profiling localized the added work to per-job child-effect bookkeeping and repeated generic trigger preparation/checking. The simulator-only fixes were:

- drain the existing used-effect scratch arrays in place and create parent-use context only when a child-bearing parent was actually selected;
- cache preparation-time use contexts and precompute attack/turn frequency and probability checks.

The tournament runner, workers, jobs, batching, output, and command arguments were unchanged. Two final candidate-then-baseline adjacent pairs were:

| Pair | Candidate wall | Baseline wall | Candidate user CPU | Baseline user CPU |
| --- | ---: | ---: | ---: | ---: |
| 1 | 48.05 s | 51.82 s | 688.78 s | 749.43 s |
| 2 | 49.08 s | 56.99 s | 704.75 s | 766.30 s |

The optimized candidate therefore passes matched no-slowdown in both confirmation pairs and also passes the historical 56.447-second absolute gate in both runs. A final exact candidate run with normal progress output, rather than redirected stdout, took 51.89 seconds wall time and 756.73 seconds user CPU, independently confirming the absolute gate. Earlier pairs varied substantially with machine contention, which is why the no-slowdown conclusion uses adjacent baseline comparisons and reports total user CPU as well as wall time.

The complete no-seed testcase corpus ran 267 cases: 5 failed, 19 improved, 20 worsened, with +0.01% average signed error. The correct pre-change baseline was 5 failed, 6 improved, 4 worsened, also with +0.01% average signed error. The unchanged failures and aggregate signed error do not imply row-level parity; the increased changed-row counts are expected evidence of the trigger-regime migrations and remain visible for review.
