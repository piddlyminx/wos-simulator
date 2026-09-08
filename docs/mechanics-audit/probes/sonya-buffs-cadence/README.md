# Prospective Sonya S1/S2 probe

**Captured: game and the exact-report-input replay both leave 1,175 defenders.** Minxxx, no heroes, attacks with **2,200 T6 Infantry**. WIP defends with **Sonya 1/1/0 and 800 T6 Infantry + 200 T6 Lancers + 800 T6 Marksmen**. This preserves the freshly captured WIP kit; S3 is locked on this account. T6 retains the baseline class passives and avoids higher-tier chance skills and FC skills. There are no joiners or other heroes.

The roster records confirm minxxx Sonya 1/0/0 and WIP Sonya 1/1/0. Before this capture, no `testcases` JSON mentioned Sonya, so the accepted evidence did not yet exercise either skill. The current definition gives S1 +4% all-troop damage and S2, every second normal Lancer attack, an extra 15% skill attack plus +5% all-troop Attack on the next turn. `advanceNormalAttackCounters` in `simulator/src/simulator.ts` and `preparedAttackFrequencyMatches` in `simulator/src/runtime.ts` establish the current normal-attack cadence. These are simulator rules, not game observations.

| Frozen candidate | WIP survivors (I/L/M) | Rounds | Sampled ±0.05 stat range |
| --- | --- | ---: | --- |
| Current full-kit rules | 1,095 (95/200/800) | 117 | 1,094–1,096 |
| Only S2 Attack buff restricted to Lancers | 1,081 (81/200/800) | 119 | 1,081–1,082 |
| Only S1 damage buff restricted to Lancers | 1,073 (73/200/800) | 121 | 1,072–1,074 |
| S2 on every normal attack after the second | 1,124 (124/200/800) | 112 | 1,123–1,125 |
| Only S2 Attack buff starts in the current turn | 1,094 (94/200/800) | 117 | 1,093–1,095 |
| S2 becomes a +15-point normal-damage modifier | 1,095 (95/200/800) | 117 | 1,094–1,096 |
| S1 uses the active hero Attack bucket | 1,095 (95/200/800) | 117 | 1,094–1,095 |

The first four rows are the useful endpoint discriminator at these provisional inputs. The other three document what a matching result cannot resolve. S2's normal-damage alternative is additive within the hero damage bucket, not a separate multiplicative 1.15 factor. The faster-cadence candidate is exactly first attack 2, then every normal attack; it does not claim to reproduce every historical extra-attack counter implementation.

All defender troop lines survive under every candidate and all 290 precision samples; the minimum remaining Infantry is 72. Lancers keep attacking throughout, and the attacker's single Infantry target prevents mixed-target exhaustion. The formation was selected through simulator-only screening of eight small mixed formations and 18 attacking Infantry counts, prioritizing separation of scope/cadence candidates while retaining defender Infantry. Screening is stored at `tmp/mechanics-audit-2026-09-07/sonya-design.json`, with its SHA256 in `manifest.json`. No live control fixture was created.

## Conditional inputs and limits

The stats are the **exact displayed values from the first Gwen report**, timestamp **2026-09-07 05:05:04**, supplied by `../gwen-blastmaster/captured-input.json`. They are only a conditional starting input for this different hero setup. WIP previously had no heroes; adding Sonya can change Lancer stats. Minxxx previously had Gwen, though this probe uses Infantry. Refresh all stats from the actual Sonya battle report before judging any prediction. Report-resolved values already include hero-generation stats: **do not add generation bonuses again**.

The precision sweep varies the 16 used stats independently within displayed ±0.05 using 256 shared interior vectors, 32 coordinate endpoints, and two opposing corners, seed `20260907`. It is a sensitivity screen, not an exhaustive bound and not an allowance for account/hero changes. Every vector and resulting endpoint is retained in `prediction.json`.

A matching full endpoint would support the reachable combined S1/S2 model and discriminate the listed scope/cadence alternatives if their fresh-stat predictions remain separated. It would not individually establish every coefficient, timing phase, arithmetic bucket, extra-attack delivery rule, or interaction. One/two-troop residuals are within Paul's requested tolerance and should be disclosed; larger residuals stay unresolved unless the evidence policy's explicit boundary conditions are demonstrated. Battle Details counts and attributed kills diagnose the same trajectory and cannot rescue an unexplained endpoint mismatch. S3 TorrentialImpact, widget VortexTurret, other levels, joiner/rally interactions, and chance interactions remain untested.

## Capture and replay

The parent agent owns both emulators. Run once from repository root when ready:

```sh
./skill/scripts/wosctl --instance minxxx run-testcase docs/mechanics-audit/probes/sonya-buffs-cadence/spec.json
```

Verify the actual heroes/levels, troop IDs/counts, report identity, Stat Bonuses, and any extra active account or widget effect. Preserve report screenshots and the single new observation. Per-line survivor counts and full Battle Details are useful diagnostics; they are not extra independent observations.

Create a new BattleInput JSON from that report with the same heroes/troops as `spec.json`, fresh report-resolved stats under `inf`/`lanc`/`mark`, and no added generation bonus. From repository root:

```sh
npx --yes tsx docs/mechanics-audit/probes/sonya-buffs-cadence/predict.mts /absolute/fresh-input.json /absolute/captured-prediction.json
```

`predict.mts` checks 39 frozen source/artifact hashes, applies the exact `candidates.json` patches, checks that the full hero/troop setup is unchanged, asserts deterministic hydration, and refuses to overwrite any output. If the simulator engine changes, replay stops instead of silently changing the frozen prediction. Preserve the original manifest; use the original source revision or a separately documented replay package for a changed engine. `config-snapshot.json` freezes all configuration, so later live config changes do not alter these candidates.

Frozen before any Sonya capture:

- Configuration snapshot SHA256: `bcb0d3068845ca143802c6e59cd7a530a8440606133b770613c418bed425b17c`.
- Prospective `prediction.json` SHA256: `8ae156a8e3072abf97142cf1bb0086af258d349020aebcd679934f195e3592d5`.
- `manifest.json` includes exact source hashes, source revision, original input/report/roster hashes, and the prospective command.

Validation: all seven candidates and 2,030 precision trials completed; all hydrated deterministic. All JSON files parse. The replay overwrite guard rejects reuse of `prediction.json`, leaving its hash unchanged.

## Capture execution

The first attempt stopped before defender deployment because `skill/templates/heroes/Sonya.png` did not exist. No battle occurred. The [saved picker](hero-picker.png) supplied a90×40 portrait crop at x240/y790. Opening that same card's View screen independently confirmed [Sonya's identity](hero-identity.png); the [Expedition skill screen](hero-skills.png) confirms the full1/1/0 kit and displayed S2 values15% damage/5% Attack. The portrait template was added for the retry. Frozen battle inputs, candidates and predictions are unchanged.

## Captured agreement

The report dated **2026-09-07 05:52:29** records **1,175 defenders: 175 Infantry, 200 Lancers, 800 Marksmen**. Sonya raises reported Lancer Attack/Defense from provisional 208.5/207.4 to 369.3/368.2. Other active input fields are unchanged. [Exact-input replay](captured-prediction.json), retaining all frozen behavior candidates, gives current 1,175; S2 Lancer-only 1,164; S1 Lancer-only 1,158; faster S2 cadence 1,204. The original 1,095 forecast remains preserved as a conditional prediction using prior no-hero stats.

Battle Details shows S1 activated once and S2 **51 times**, with 16 displayed S2 kills. The current replay also schedules 51 S2 activations over 103 simulated rounds; no explicit game round count is available. [Overview](report_top.png), [stats](report_stats.png), [Battle Details](bd_top.png), [defender troop breakdown](defender-troops.png) and [observation](observation.json) preserve the evidence. Counterpart mail 2734692464122411 is the same battle and adds no independent observation.

The same-turn S2 alternative gives 1,174, and alternate damage/Attack buckets give 1,175. Those remain indistinguishable at the requested tolerance. The subsequently adopted fractional square-root army term also retains raw 1,175 in the 293-case production parity run; it does not alter this agreement.
