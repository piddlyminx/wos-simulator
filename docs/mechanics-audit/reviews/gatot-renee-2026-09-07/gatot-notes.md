# Gatot: shield kinds, enemy scope and residuals

All63 active Gatot fixture entries and their63 stored outcome records were replayed for each selected skill. Chance-bearing configurations receive500 simulations per model, deterministic configurations one. Exact tier/FC keys, report stat scales and1500-round caps remain unchanged. Separate fixture entries are separate comparisons, not proof of independent report identities.

The sequential conserved shield pool, fractional casualty accumulation and ceiling of live source troops for attack/shield strength are established constraints and were preserved. Discarded fixed per-formation pool reservations were not reopened. Historical chronological notes contain earlier provisional models and predictions; fresh results below supersede their numeric forecasts, not their accepted game observations.

## Strong contextual evidence

| Fixture key | Game / current | Selected alternatives |
|---|---|---|
|`testcases/gatot_verified/s34-current-2100-lancer-2100-marksman-vs-1100-gatot3-inf.json#0`|D236@179 /D236@179|Omit GoldenGuard →A468; omit KingsBestowal →A2048; omit RoyalLegion or restrict it to enemy Infantry →A112.|
|`testcases/gatot_verified/s35-current-3000-lancer-1000-marksman-vs-1100-gatot3-inf.json#0`|D314@167 /D314@167|Omit GoldenGuard →D131; omit KingsBestowal →A1661; omit RoyalLegion or restrict it to enemy Infantry →D168.|
|`testcases/gatot_verified/s38-current-bilateral-gatot-800-inf-800-marksman-vs-1100-inf.json#0`|D224@343 /D224@343|Omit GoldenGuard →A282; omit KingsBestowal →A1070; RoyalLegion enemy-Infantry-only →A812. GoldenGuard all-own recipients →D220@346, a much weaker four-survivor distinction.|
|`testcases/gatot_verified/s41-300-inf-200-lancer-600-marksman-vs-500-inf.json#0`|A939@196 /A939@196|Omit shield →A949@113. Current trace consumes the same shield across Infantry, Lancer and Marksman incoming jobs.|

These support GoldenGuard's positive contribution, RoyalLegion affecting attacking classes beyond Infantry, and KingsBestowal's positive protection. GoldenGuard's exclusive Infantry scope is not certified: broadening it to all own classes leaves61 of63 fixtures' current samples/endpoints unchanged and only changes the other two by4/5 survivors. That is weak discrimination at their army scales. The ledger records contribution only for GoldenGuard.

The existing section41 evidence notes also preserve source-attributed game kills I1/L10/M164, corroborating sequential spill across both attack-order boundaries. These are diagnostics from the same battle, not extra observations. No new pool-distribution hypothesis was needed for this review.

## Shield protection includes skill damage

`testcases/gatot_verified/s42-current-wayne-skill-shield-scope-200-inf-vs-450-inf.json#0` records A200/D168 after1500 rounds. The attacking200T6I have Gatot S2level3; defending450T6I have Gatot S2level1 and Wayne3/3/3. Prior accepted Battle Details records both shields firing1500 times, Wayne375 ThunderStrike and234 Fleet activations. The UI awarded the defender the capped-battle win; the evidence schema deliberately normalizes both-armies-live to draw. Preserve that convention rather than inventing agreement between UI and simulator winner labels.

Current samples are424/500 exact **A200/D168@1500**, and76/500 **A199/D172@1500**. Every sample is a draw; mean signed A−D31.24/SD1.797 versus game32, p1. Restricting only KingsBestowal's eligibility to normal damage eliminates the attacker in all500 runs: mean defender407.216/SD2.869, rounds918–1148, p0.00005. Omitting the shield also eliminates it in every run, mean defender307.348, rounds257–283. Current trace counts include9485 shield applications to Wayne skill jobs across the first16 runs; the normal-only variant has none. This is strong contextual support for genuine skill-damage protection, distinct from the weakly informative S8 threshold fixtures.

The reciprocal cap fixtures preserve both sides exactly:

- `testcases/gatot_verified/s43-current-reciprocal-shield-cap-450-inf-vs-200-inf.json#0`: game/currentA173/D200@1500, signed−27. Shield omission changes it to A263/D0@361.
- `testcases/gatot_verified/s44-current-reciprocal-shield-cap-2500-inf-vs-500-inf.json#0`: game/currentA975/D498@1500, signed477. Shield omission changes it to A2214/D0@217.

The current count cap and source strength are retained; this omission review does not separately re-establish every coefficient, shield-generation input or delay rule. Skills are changed for all Gatot owners when a fixture is bilateral. Single-Gatot sections34/35 provide cleaner ownership context.

## Existing disagreements remain

`testcases/gatot_verified/s3-5000-inf-vs-1000-inf-10-lancer.json#0` remains **gameA4573@1151 /currentA4996@1037**, a423-survivor and114-round residual on5000-versus1010 armies. Accepted prior source evidence confirms its troop counts and report arithmetic; no count, level or stat correction is inferred. GoldenGuard omission4992, RoyalLegion omission4974 and enemy-Infantry-only4982 remain far away. Shield omission4121 also fails. The tested restrictions therefore do not provide a supported cause or fix.

Other combined fixtures retain exact numeric residuals:

| Fixture key | Game / current |
|---|---|
|`testcases/gatot_verified/s10-bradley-1000-inf-125-marksman-vs-5000-inf.json#0`|D2296@875 /D2274@881|
|`testcases/gatot_verified/s15.2-secondary-heroes-1000-inf-125-lancer-125-marksman.json#0`|A851@366 /A834@376|
|`testcases/gatot_verified/s15.3-2000-inf-0-lancer-1000-marksman.json#0`|A1281@907 /A1327@898|

There are14 Gatot deterministic entries with raw absolute A−D error above2, including capped-battle defender residuals5–14 and several3–10 residuals at larger scales. `summary.json` lists all exact side and known-round errors; they are not14 automatically material failures. For example the3-survivor gap at4491 surviving defenders and equal278 rounds is weak basis for changing a mechanic. The46-survivor/9-round S15.3 residual remains explicit, without reverting established pool semantics to improve that one point.

Two stochastic threshold records retain low combined probabilities at the initial500-run budget:

- `testcases/gatot_verified/s8-11548-t9-marksmen-vs-one-t1-fc10-infantry.json#0`: gameA11268/D1@1500, score11267. Current mean11344.842/SD25.175, p0.00175. One of500 samples reproduces the exact sides and round;499 eliminate the defender. The accepted observation is possible but rare under this model.
- `testcases/gatot_verified/s8-25000-t9-marksmen-vs-one-t1-fc10-infantry.json#0`: gameA24929/D0@329. Current mean24963.074/SD9.463, p0.00255; one of500 scores is at least as low, none matches the exact side totals. Current rounds span79–388. The34-survivor mean difference is small relative to25k, but the recorded trajectory remains in a low-probability tail; scale alone does not settle distribution compatibility.

Both preserve `infantry_t1_fc10:1`, Gatot5/5/5, T9 Marksmen and all relevant troop skills. The normal-only shield restriction produces precisely the same S8 samples as current: those fixtures do not distinguish shield skill-kind eligibility. Earlier larger-sample tail investigations remain relevant; no fresh probability/coefficient fit or additional sampling was warranted just to relabel the same unresolved interaction.

Two more accepted historical game records are listed in `simulator/src/tooling/gatotEvidence.ts` but remain non-runnable because the complete attacker stat block and historical T11 FC10 catalogue are unavailable: `s6-historical-t11-fc10-vs-10000-t6-marksmen` givesA5895/D1@1500; `s6-historical-t11-fc10-vs-3000-t6-marksmen` givesA0/D1@1086. Their observations are retained as evidence, outside the88 replayable-entry count. No present-day troop catalogue or guessed stat block was substituted.

GoldenGuard active levels1/2/5 and KingsBestowal/RoyalLegion1/2/3/5 are present, but the strongest scope/kind examples cover a narrower subset. Exact level curves, attack-stat versus other bucket identity, every timing/stacking interaction, protection of absent troop classes, mode/widget gates and joiners remain unreviewed beyond the claims above.
