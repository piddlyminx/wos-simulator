# Greg S2 positive-contribution probe — 2026-09-07

**Completed: five verified battles support positive S2 contribution from Infantry attacks.** Game defender survivors are113/108/109/113/110, mean110.6 and sample SD2.302. Against the exact verified input, the frozen current model predicts111.049, per-battle SD4.326 and combined p0.840858. The S2-omission model predicts124.271, SD2.833 and p0.000100. This is a useful new discriminator where the seven older input sets accepted omission. No production skill change was needed.

| Displayed report time,2026-09-07 BST | Defender survivors | Greg S1/S2 reported activations | Preserved evidence |
|---|---:|---:|---|
|08:32:39|113|15/22|[Capture1](capture-01/observation.json)|
|09:45:59|108|23/22|[Capture2](capture-02/observation.json)|
|09:52:08|109|16/28|[Capture3](capture-03/observation.json)|
|10:00:17|113|16/17|[Capture4](capture-04/observation.json)|
|10:05:22|110|20/21|[Capture5](capture-05/observation.json)|

All reports are distinct battles at X791/Y577. Every attacker ends at0, every defender survivor is a Marksman in the verified single-class formation, and all24 stat bonuses and full110 kits were visually checked. No game rounds or stable server mail IDs were exposed. Battle Details shows dashes for skill kills; those are preserved as unknown, not zero.

The first report's troop-return notification obscured both Infantry Attack values and caused OCR to substitute lethality values. The original parsed fixture and images are preserved. A clean defender-side counterpart of the same timestamp establishes the correct308.2% attacker and248.2% defender Infantry Attack, with roles reversed correctly. [The correction record](capture-01/input-correction.json) changes only those two input fields, never the113 outcome. Actual selected Greg Marksman stats differ from the input-only nohero estimate, but that source line is absent; all8 used combat stats equal the frozen forecast. The [verified-input replay](capture-01/captured-prediction.json) reproduces every4096 endpoint row per model exactly. The other four battles have identical full inputs and require no stat correction.

[The five-battle comparison](comparison-five-battles.json) retains both distributions and exact fixture hashes. A separate500-sample production runner check gives111.110, SD4.260 and p0.886756 with no errors or warnings; [its raw result](production-validation.json) is preserved. The narrower five-game sample spread is plausible at this sample size; it does not prove an exact variance or probability. The original proposal and conditional forecasts follow unchanged.

The frozen proposal is **minxxx full Greg1/1/0 with200 T6 Infantry attacking WIP nohero400 T6 Marksmen**, five independent battles. Existing Greg cases do not distinguish S2 from omission. Here a single enemy line remains present throughout the battle, giving its debuff consequential follow-up attacks. The sole Infantry source also distinguishes the configured all-troop eligibility from a Marksman-only trigger, which would have no eligible source here.

S1's20% chance/8% damage/three-turn window stays active. S2 retains its configured20% chance,10% enemy damage reduction and delayed two-turn window. S3 is actually locked at0, and the rally widget is inactive in this solo setup. No hero level is disabled for isolation and no coefficient is fitted. A14-formation input-only screen compared twelve two-line armies and two one-line source diagnostics; the Infantry-only case had a useful omission gap and less variance than the Lancer-only alternative. No game outcome from this new formation was known during design.

| Frozen model | Defender survivors, mean / per-battle SD | Central95% per battle | Central95% five-battle mean |
|---|---:|---:|---:|
| Current full110 kit |111.049 /4.326|103–119|107.2–114.8|
| Only S2 contribution becomes zero |124.271 /2.833|119–130|121.8–126.8|

Each model uses4096 seeded simulations. Five-battle means use32,768 resamples of five independent draws from its simulated distribution. These are conditional predictive distributions, not guaranteed bounds or probabilities that a mechanic is true. The13.22-survivor mean separation is substantial for this600-troop setup. All256 corners of eight used report stats at±0.05 across eight fixed seeds change the paired endpoint by at most1 under either model. This is a sensitivity screen, not a proof of every interior combination in a non-monotonic system.

The original input uses freshly observed **nohero minxxx Infantry308.2/300.5/244.0/238.4** from the first Reina report and **WIP Marksman217.5/210.6/181.4/177.0** from the Edith report. Greg is a Marksman hero, and no own Marksmen are deployed, so his unknown selected Marksman block is unused. Selecting Greg is still followed by full report verification: no future report stat is invented or assumed measured, and generation is never added again. The exact frozen input, config, runtime archive and candidate definitions are preserved with hashes.

Capture the first battle exactly once. Verify its actual full110 kit, exact T6 troops and all report stats, then replay these same models with the actual input before collecting the other four. Keep each outcome and distinct report identity; counterpart mail is the same battle. Preserve winning defender Marksman count and Battle Details, without inventing game round counts or interpreting displayed passive activation counts as individual proc rolls. Stop for a formation/input error, not because an outcome agrees or disagrees. No default control is planned.

A plausible five-game distribution under current and an implausible omission model would support positive S2 contribution from an Infantry source in this context. One enemy class cannot identify target-locked versus all-enemy scope, and this comparison does not uniquely identify20% chance,10% magnitude, exact delay/duration, stacking or higher levels. S1's remaining uncertainty is retained even though it is supported by earlier repeated fixtures.

Replay without changing the original assets:

```sh
npx --yes tsx docs/mechanics-audit/probes/greg-deterrence/predict.mts /absolute/input.json /absolute/new-output.json
```

The helper verifies every frozen asset/source hash, enforces the same full kit/troops and rejects existing output paths. Later supplied-stat output is labelled a replay without claiming the outcome was unseen. The original screen is `tmp/mechanics-audit-2026-09-07/greg-deterrence/screen.json`; [prediction.json](prediction.json) retains individual frozen simulations and precision cases.
