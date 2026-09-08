# Reina S1/S2 disconfirmation — 2026-09-07

The bounded alternatives do not rescue an additional20% S3 model. Retain the corrected additional120% implementation at level1. No additional control battle is justified by this review.

Paul correctly raised that a displayed120% can describe either an additional attack or an ordinary100% attack replaced by120%, a net20% increment. The skill description alone does not distinguish those implementations. All five new outcomes were known during this retrospective check. Historical inputs were inventoried and directional predictions recorded before their numeric outcomes were read here; this is not a prospective game test.

We preserved the five observations, full kits, exact troop/FC keys and report stats. Each of14 accepted fixtures received2048 runs for each of five fixed candidates using the Reina probe's archived runtime/config. Its outer army-term ceiling is absent; fractional troop state and the inner living-source ceiling remain intact. Only the specified Reina effect changes vary. No coefficient search, game interaction or production edit occurred.

| Model | New-probe defender mean / SD | CDF/support p for five outcomes |
|---|---:|---:|
| Additional20%, current one-attack dodge |179.17 /1.97|0.000150|
| Additional20%, normal damage kind |178.83 /2.02|0.000100|
| Additional20%, one shared4% dodge roll per round |179.19 /2.98|0.000100|
| Additional20%, reactive4% dodge lasting through the round |175.38 /4.03|0.000250|
| Additional120%, current one-attack dodge |162.89 /6.53|0.599520|

The game mean is164.6, sample SD6.1887. A normal-kind20% increment also receives S1's10% normal bonus, but the resulting shift is small. A shared dodge roll broadens variance without explaining the much lower survivors. The reactive-round alternative increases protection but remains incompatible with the new group. These p-values use the repository's CDF/support comparison,2048 simulated outcomes and the default0.004 diagnostic threshold. They are finite Monte Carlo estimates, not probabilities that a model is true. No per-case precision adjustment or outcome deduplication was performed.

The strongest independent disconfirmation is `testcases/heroes_unittests/Reina_tc.json::2`: Reina has S1=1/S2=2 and S3 absent. Its six accepted attacker endpoints are1536,1325,1500,1333,1297,1579, mean1428.33. Current one-attack dodge predicts1413.22/SD119.99 (`p=0.870456`); reactive dodge continuing through the round predicts772.78/SD397.28 (`p=0.000100`). The shared-round alternative remains plausible here (`p=0.949003`), so this review does not identify S2's exact correlation across attacks. That ambiguity does not rescue the small S3 increment in the new formation.

Both S1-only deterministic cases, `Reina_tc.json::0` and `::1`, reproduce their accepted62 and40 defender survivors exactly, with S3 absent; the latter also includes Jasser. All13 older rows pass the current model's comparison in this bounded run. The older Wayne/Reina eight-outcome row is near the diagnostic threshold (`p=0.010549`); it is retained rather than discarded, and this review makes no claim that every remaining mechanic is settled.

This supports level1 S3 magnitude and current-target scope in the captured full-kit context. The120/140/160/180/200 curve is visually verified, but levels2–5 have no S3-enabled battle in this14-row set. Exact proc chance, S2 correlation and target-exhaustion behavior remain limited. Paul subsequently [confirmed that Reina S3 and Philly S2 are skill damage](../../damage-kind-confirmation-2026-09-07.md). That accepted classification comes from his direct confirmation; these magnitude replays do not independently identify it. The normal-kind diagnostic above remains an archived counterfactual. [The capture package](../../probes/reina-shadowblade/README.md) preserves original forecasts, exposure history, distinct reports and skill description images. Philly's separate inclusive-total result must be interpreted from its own scope and outcomes; similar printed percentages do not establish identical delivery semantics.

`predictions.json` contains all seeded samples and fixed candidate definitions; bulky trace copies remain in `tmp/mechanics-audit-2026-09-07/reina-alternate-semantics/predictions.json`. `parity.json` preserves all37 actual observations by fixture path and index. The `inputs.json` field named `observations` is preliminary metadata: for three legacy singleton object outcomes it mistakenly counts object keys; use `parity.json`'s actual arrays. No observation was added or removed from testing.

From repository root, the independent replay scripts reject existing output paths:

```sh
npx --yes tsx docs/mechanics-audit/reviews/reina-alternate-semantics/screen.mts /absolute/new-predictions.json
npx --yes tsx docs/mechanics-audit/reviews/reina-alternate-semantics/compare.mts /absolute/new-parity.json
```

The first script verifies the original runtime archive and source hashes. The second reads the durable frozen `predictions.json` and current accepted fixture observations; its output must be described as a replay against those current observations. `manifest.json` records saved artifact hashes. Original capture forecasts remain untouched.
