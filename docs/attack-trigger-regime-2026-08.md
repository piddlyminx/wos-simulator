# Attack-trigger regime results (2026-08-08)

This document records simulator choices and evidence. It does not claim that unresolved behavior is confirmed game truth.

## Implemented runtime contract

- A normal attack is resolved procedurally: lock target, reject same-round exhaustion, snapshot pre-existing controls, reject `no_attack`, run attack cadence and type-less carriers, resolve dodge or normal damage, then run extra attacks and deferred consequences.
- Cadence counters belong to `(side, troop type)` and count actual normal attacks only. Dodge counts. `no_attack`, exhausted-target skips, and extra skill jobs do not.
- Dodge is a zero-kill normal outcome (`dodged: true`), not a cancellation. It has no damage equation, but attack triggers, nested children, and extra attacks continue.
- Turn triggers have no source or target. Their effects use concrete scopes; one broad turn-scoped effect can participate in every matching normal attack during its active window.
- Effects may contain keyed `trigger_effects`. Typed parents materialize children only when their primary mechanic is actually used. A type-less parent is a bounded normal-attack carrier. Children use `parent.use.source` and `parent.use.target` and cannot affect the same damage job that caused their creation.
- Duration-only charging on dodge or `no_attack` expires attack-limited effects without pretending their primary mechanic was used; it does not materialize children.

## Config migrations

- Gordon `VenomInfusion`, Gwen `AirDominance`, and Xura `PiercingArrow` use actual per-unit normal-attack cadence. Air Dominance therefore fires independently for each troop type on attacks 5, 11, 17, ... .
- Blanchette `BloodHunter`, Sonya `TorrentialImpact`, Wayne `ThunderStrike`, and Ahmose `ViperFormation` use source-less turn cadence with fixed effect scopes. Thunder Strike uses one broad one-turn extra-attack effect, which naturally serves every eligible normal troop attack without matching skill jobs.
- Sonya's Torrential stun is nested under the extra attack. If the parent emits no job because the locked target is already exhausted, no stun is created. The stun starts next round. `BountyTemptation/2` also starts next round.
- Existing one-round delays for Gordon `VenomInfusion/2`, Norah `Momentum`, Greg `DeterrenceOfLaw`, and Xura `PiercingArrow/2` are retained.

## Renee cadence comparison

Both candidates retained the existing health-down buckets:

1. actual-attack candidate: every second successful normal Lancer attack applies target-locked typed effects to that attack;
2. strict-turn candidate: every second turn creates a one-turn, one-use Lancer carrier, which expires unused if no eligible Lancer attack occurs.

The focused no-seed testcase corpus was identical for both candidates: 2 run, 0 failed, 0 improved, 1 worse, average signed error -0.34%. The available cases contain no pause/exhaustion distinction, so they do not choose between the candidates. The implementation selects actual-attack cadence because the skill text says attacks and because it preserves cadence across blocked attempts; this is a reasoned initial choice, not game confirmation.

## Verification ledger

Confirmed in synthetic engine tests:

- source-scoped 5/11/17 cadence for infantry, Lancer, and Marksman independently;
- extra jobs do not alter cadence and carry no cadence counter deltas;
- exhaustion and `no_attack` suppress attack triggers and counters;
- dodge preserves triggers/extras and produces no damage trace;
- one broad turn-scoped extra-attack effect serves every matching normal attack without recursively matching generated skill jobs;
- a typed parent's child appears after actual use, never on the consuming job;
- a one-turn carrier expires unused.

Still unresolved as game truth:

- whether Renee is attack cadence or strict turn cadence, and whether the current health-down buckets are the right damage model;
- whether dodge should count as a hit for every hero consequence (the simulator currently treats it as an attack but zero normal damage);
- Blanchette's exact cadence wording;
- Sonya stun timing beyond the initial next-round interpretation;
- whether Ahmose's pause and protection share exactly the same in-game phase ordering.

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
