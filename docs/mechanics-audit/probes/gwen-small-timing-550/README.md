# Gwen timing probe: captured550 versus900
**Game: defender24, all Infantry. Current simulator: attacker76.** The report dated2026-09-07 06:29:43 has exactly the frozen input, verified visually and by full input equality. The unchanged frozen replay reproduces every prospective prediction. This is a material disagreement at this scale: it changes the winner and leaves a100-unit signed endpoint difference.

Game Battle Details shows S1=1/dash, S2=15 activations/7 kills, and S3=18 activations/36 kills. The defender lost all45 Lancers and all45 Marksmen behind its surviving24 Infantry. [Observation](observation.json), [troop table](defender-troops.png), [fresh replay](captured-prediction.json) and the complete report images preserve the evidence. Counterpart mail2734692464123174 is the same battle.

Neither of the additional preparation-count alternatives frozen before this outcome agrees: first4/every5 predicts defender79 and first5/every5 defender114. Their [separate review](../../reviews/gwen-preparation-snapshot/README.md) retains the original exposure boundary. No tested simple schedule/source-count variant explains all three new Gwen captures. This does not identify S3 timing as the sole error; target depletion and S1/S2 effect handling remain causal questions. No production hero change has been made.

## Original prospective design

Minxxx attacks with its full Gwen3/1/1 kit and550 T6 Marksmen. WIP defends with no heroes and810 T6 Infantry,45 T6 Lancers and45 T6 Marksmen. No outcome for this formation has been captured or read at prediction freeze. The two earlier long Gwen outcomes were known during candidate selection.

Positive scores mean attacker survivors; negative scores mean defender survivors. This is a substantial outcome separation on armies below1,000, replacing the withdrawn30k onset design whose five-survivor gap Paul correctly judged uninformative.

| S3 model | Nominal score | Sampled report-stat range | Nominal rounds |
|---|---:|---|---:|
| current | +76 | +75 to +76 | 78 |
| first4_every5 | -98 | -100 to -93 | 76 |
| first5_every5 | -125 | -128 to -123 | 71 |
| phase6 | +52 | +51 to +53 | 83 |

The four models differ only in Blastmaster timing: currentfirst5/every4, first4/every5, first5/every5, and phase6first6/every4. All retain complete S1/S2 behavior, source/target rules, fractional casualties and the inner attack-count ceiling. The adopted engine has no additional outer ceiling around the square-root army term. Every candidate's winning side remains unchanged across563 shared stat vectors, and the closest sampled endpoint ranges remain22 survivors apart.

This is a whole-battle timing discriminator, not an isolated first-activation measurement. Infantry and then backlines can exhaust, and existing charge consumption and targeting rules interact with timing. Agreement can favor a candidate in this full-kit context; it cannot prove unique trigger versus delivery representation, snapshot semantics, exact magnitudes, reporting rules, or correctness of all mixed-target behavior. A match here must also agree with accepted earlier evidence before any production timing change. None of the existing simple schedules yet explains both long captures.

The displayed-stat screen uses±0.05 for all24 report fields: the nominal vector, two opposing corners,48 one-field endpoints and512 shared random vectors. All vectors and outcomes are retained. This is a sampled non-monotonic sensitivity screen, not a proof that the entire input box has been exhausted. Current and every5 variants cross some round boundaries while retaining separated endpoints. Fresh report stats must be verified; replay any changed fields with the same frozen models and preserve the original forecasts. These stats already include hero bonuses.

Capture once using `capture-spec.json`. Preserve the overview, exact troop counts and hero kit, all report stats, complete skill details and the winning side's troop breakdown. Skill counts and attributed kills are diagnostic views of the same battle, not extra observations. Nominal endpoints are primary; allow roughly1–2 survivors at this scale and retain any supported input-sensitivity explanation separately.

The search screened18,144 candidate simulations. A750-versus950 design was not selected because its closest sampled ranges approached within7 survivors and one candidate could change winner within report precision. `selection.json` preserves that decision and the screen hash. Original candidate models and input live in `variants.json` and `input.json`; the runtime archive and all29 source hashes are frozen in `manifest.json`.

Replay from the repository root to a new path:

```sh
simulator/node_modules/.bin/tsx docs/mechanics-audit/probes/gwen-small-timing-550/predict.mts /absolute/new-output.json /absolute/fresh-stats-input.json
```

Omit the last argument to replay frozen stats. The helper validates artifact/runtime hashes, imports only the archived engine, and refuses existing or in-package output paths. Replays make no claim of blindness to outcomes. `prediction.json` is the immutable prospective output; its SHA256 is `55aeb3eb2d166094ebeab424867524ff01de22000d593fd045a62ce172435fff`.
