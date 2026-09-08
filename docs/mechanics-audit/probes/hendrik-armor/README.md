# Hendrik S2 on Lancers

One deterministic battle captured on2026-09-07. **Game and the frozen model both leave17 defending Lancers.** The design and predictions below were frozen before that observation.

- **minxxx attacks:** 100 T6 Lancers, no heroes.
- **WIP defends:** 150 T6 Lancers, full freshly captured Hendrik **3/3/3**.
- Expected committed troops: 250 total; configured simulator losses: 233 troops. These are battle casualties, not a prediction of permanently lost troops.
- [Spec](spec.json), [frozen predictions](prediction.json), [input](input.json), [configuration snapshot](config-snapshot.json).

The primary question is whether Hendrik's periodic defensive contribution applies to Lancers. His S1 remains enabled. The lack of Marksmen gates S3 **in the current simulator**, while an explicit alternative allows S3 to use Lancers. This is a full-kit, composition-gated experiment rather than a direct S2-only game fixture.

The only older active Hendrik fixture is `testcases/emulator_verified/renee_hendrik_defense_bucket_nc.json::0`: minxxx Renee4/4/4 plus Hendrik1/0/0. It provides no S2/S3 observations. Sonya1/1/0 also has fresh gaps, but her 4% S1 is a smaller effect than Hendrik S2's configured 18%, so Hendrik is the stronger first probe.

## Frozen conditional predictions

The fresh Gwen report supplied Lancer bonus fields: minxxx **294.9/293.7/224.3/230.0**, WIP **208.5/207.4/186.8/181.9**, ordered Attack/Defense/Lethality/Health. Parent visually verified [report_stats.png](../gwen-blastmaster/report_stats.png). These are report-resolved percentage bonuses; no hero-generation stats are added.

They are conditional inputs for this different lineup. Switching from Gwen to nohero minxxx and nohero to Hendrik WIP is assumed not to alter the Lancer report fields, since both heroes are Marksman heroes. The actual Hendrik report supersedes that assumption. Replace the eight Lancer stat fields in every unchanged candidate before interpreting the endpoint.

| Candidate | Outcome | Rounds | Sampled ±0.05 precision range |
|---|---|---:|---|
| Configured S2 | WIP **17** survivors | 54 | WIP17 |
| S2 absent, or Marksman-only | minxxx **9** survivors | 53 | minxxx9 |
| S2 is Damage Taken Down | WIP17 | 54 | WIP17 |
| S2 delayed one round | WIP16 | 54 | WIP16 |
| S2 duration only one round | WIP4 | 60 | WIP3–4 |
| S2 first starts round1 | WIP20 | 52 | WIP19–20 |
| S1 is10% rather than15% | minxxx1 | 65 | minxxx1 |
| S1 is20% rather than15% | WIP27 | 48 | WIP27 |
| S3 uses Lancers | WIP33 | 45 | WIP33 |

Each range uses the same 256 independent random stat vectors and 16 one-coordinate endpoints, with a frozen seed. This is a sensitivity screen, not an exhaustive envelope or a bound on lineup/account drift. Every variant was deterministic in the simulator. The configured signed endpoint and S2-absent endpoint differ by **26 troops**, with opposite winners.

Current simulator reporting shows S2 activated13 times, S3 activated18 times, but **zero S3 generated attacks** because no Marksmen exist. Activation counters must not be mistaken for executed damage. Capture the endpoint, rounds and full Battle Details; the endpoint remains the primary observation.

## What this can establish

If the fresh-stat replay still separates these candidates and the game agrees with the configured result, it supports a non-Marksman defensive contribution compatible with current S2 while rejecting the S2-absent/Marksman-only alternative for this formation, conditional on S1's magnitude and S3's source model. The diagnostic S1 and S3 alternatives make those two load-bearing assumptions visible.

It **cannot distinguish Defense Up from Damage Taken Down** here: those candidates have identical predictions. A one-round delay differs by only one survivor, so this capture also cannot settle S2 timing at the user's tolerance. Nor does it independently prove S1 scaling, every troop's eligibility, S2 stacking, or S3 cadence/damage kind/fanout. Coincidental combinations of multiple wrong mechanics remain possible.

If there is a larger unexplained residual, preserve it as a mismatch and inspect the captured inputs/Battle Details. Do not fit an arbitrary stat shift or claim that a different kill subtotal establishes parity.

## Capture and replay

The parent owns emulator interaction. Ready command from repository root:

```sh
./skill/scripts/wosctl run-testcase docs/mechanics-audit/probes/hendrik-armor/spec.json
```

For exact-stat replay, create a second stats file using `stats-input.json`'s shape and run:

```sh
simulator/node_modules/.bin/tsx docs/mechanics-audit/probes/hendrik-armor/design-hendrik.mts path/to/captured-stats.json docs/mechanics-audit/probes/hendrik-armor/captured-prediction.json
```

The helper only replays the existing frozen formation and configuration; both files are required. It writes only a new explicitly named output file, never the original input, spec or prediction. Replay metadata makes no claim of blindness to game outcomes. The runtime source state is recorded separately; if simulator code changes, retain the original forecast and identify the changed runtime in any replay.

The later S3 probe should use full WIP Hendrik3/3/3 with Marksmen against multiple enemy troop lines, preserving enough frontline for several scheduled attacks. Its actual Marksman report bonuses are not known from the nohero Gwen report; therefore no S3 numeric forecast has been invented here.

## Captured agreement and limits

The report dated **2026-09-07 05:42:10** records attacker0, defender17. All troop inputs and displayed stats were visually checked; the eight Lancer fields are identical to the frozen inputs. [Captured-input replay](captured-prediction.json) retains all nine original predictions, including the opposite winner when S2 is absent. S2 reports13 activations, while S3 reports dashes for activation and kills. [Observation](observation.json), [overview](report_top.png), [stats](report_stats.png) and [Battle Details](bd_top.png) preserve the evidence.

This supports S2's level-3 defensive contribution to Lancers and rejects the tested S3 substitution of Lancers for Marksmen. Exact S2 phase and Defense-versus-Damage-Taken bucket remain indistinguishable at the requested tolerance. S3's positive damage behavior still needs a Marksman probe. The actual WIP Hendrik Marksman bonuses are now465.5/458.7/244.0/218.8 (Attack/Defense/Lethality/Health), available for that later conditional prediction.
