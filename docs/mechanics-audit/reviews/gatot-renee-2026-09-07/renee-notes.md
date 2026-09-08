# Renee: contextual support and retained contradictions

The current model has strong evidence for NightmareTrace normal damage, a Lancer source gate and delayed delivery in the tested contexts. Dreamcatcher and Dreamslice have distinguishable source scopes. Their normal-only modifier eligibility is less conclusively identified; broadening it helps some stochastic points and modestly worsens a deterministic Gwen overlap. No production rule was changed.

All nine active Renee entries (22 outcome records), fifteen recovered archived entries (16 records, including three existing no-hero controls), and one standalone recorded Gwen overlap were retained. This gives25 distinct input entries/39 records, not39 verified independent battles. Dreamcatcher/Dreamslice compare24 entries because the active Ambusher fixture only configures S1. No cross-file inputs were identical after simulator resolution, but report identities/timestamps are unavailable; comparisons remain separate per entry. Repeated numeric records are not deleted or pooled across files. Archive keys below use `archive:testcases/emulator_verified/<filename>#0`; original bytes and the immutable stash-tree ID are in `archive-manifest.json`.

## Normal damage and source gate

`testcases/emulator_verified/renee_wu_ming_s1_damage_kind_nc.json#0` records A359 and51 NightmareTrace activations for1500T6L Renee4/4/4 into4000T6I WuMing3/3/3. Current gives exactly A359/51 activations. Changing only the generated job to skill damage gives A347/52; immediate delivery gives A367/51. The accepted archived `renee_same_kind_wu_ming_skill_damage_nc.json#0` provides a much larger separation in the opposite-side WuMing skill-boost interaction: gameA1639, current1637, skill-kind1299, immediate delivery1531. These opposite-side interactions support the current normal classification and reject the tested immediate-delivery alternative without relying solely on a12-survivor distinction at larger scale. They do not establish every preparation/delivery ordering or target-exhaustion branch.

The archived full-kit Renee4/4/4 zero-Lancer record gives game/currentA2688. Allowing the S1 mark carrier to be consumed by any own class gives2667. The100-Lancer record gives game/current2352, while broadening the carrier gives2409; its25-Lancer counterpart gives game2515/2515, current2516, broad carrier2529. Original no-hero controls give2669/2672/2688 exactly. Their hero-generation stat blocks differ from the hero fixtures and are preserved, so raw control-to-hero differences are not interpreted as isolated skill magnitudes. The full-kit counterfactuals hold those stats fixed.

The active Infantry-only `hector_renee_wayne.json#0` has no Lancers. Current, all three component omissions and S1 kind/delay alternatives produce identical samples: A1588.157/SD2.821 versus recorded1597, p0.00525. No current Renee generated damage is delivered there. This remains a high-tail combined-hero discrepancy and cannot be used to attribute an error to Renee. Broad S1 carrier changes the battle substantially, but that does not resolve the existing cause.

## Positive components and different source scopes

The table preserves full kits; each alternative removes or changes only the named component. Values are signed A−D outcomes.

| Fixture key | Game | Current | Omit S1 /S2 /S3 | S2 broadened to all friendly sources | S3 restricted to marking Lancers |
|---|---:|---:|---|---:|---:|
|`testcases/emulator_verified/renee_charge_single_target_bucket_nc.json#0`|50|50|−530 /−402 /−191|50|50|
|`testcases/emulator_verified/renee_hendrik_defense_bucket_nc.json#0`|14|14|−183 /−144 /−76|14|14|
|`testcases/emulator_verified/renee_ahmose_damage_taken_overlap_attacker_nc.json#0`|3777|3778|3556 /3648 /3663|3857|3732|
|`archive:testcases/emulator_verified/renee_kind_100_lancer_nc.json#0`|2352|2352|2447 /2421 /2414|2297|2380|
|`archive:testcases/emulator_verified/renee_kind_25_lancer_nc.json#0`|2515,2515|2516|2556 /2544 /2560|2457|2545|

The clean Ahmose attacker record now agrees within one; prior notes' large residual referred to older runtime models. In its current trace Ahmose Infantry remain alive and hit the common target, providing meaningful source overlap. Both that record and the archived small-Lancer records favor S2 limited to marking Lancer damage and S3 applying beyond Lancers. Exact target locking, blocked-attack cadence, retargeting and lifecycle consumption remain untested by these endpoint contrasts.

The five identical game outcomes in `renee_solo_nc.json#0` are D554, exactly current. S1 omission gives545; S2 or S3 omission each gives553. The latter one-unit changes are within requested tolerance and are not strong individual-component discriminators merely because five equal values were stored. Other records above provide the useful component separation.

## Modifier damage-kind eligibility remains bounded

The standalone prior diagnostic `skill/tmp/renee_gwen_2k_discriminator.ts` contains complete recorded inputs and `observed:1221`:2000T6L with Renee4/4/4+Gwen3/1/1 versus10000T6I. Only its input literal and labeled game observation were extracted; its old simulator outputs/scoring helper were not reused. Current gives1221, S2 omission991 and S3 omission1122. Broadening only S2 to normal+skill gives1233; broadening only S3 gives1227. The smaller active Gwen retry gives318/current318, versus321/319 under the two broadening alternatives.

These favor current eligibility in that Gwen context, but6–12 survivors at larger army scales alone do not certify a mechanic. In the stochastic `renee_wayne_mixed_510_vs_888.json#0`, gameA427 is plausible under current423.311/SD1.747 (p0.072396), while S2/S3 broadening improves compatibility to424.415/SD1.994 (p0.276586) and424.701/SD2.043 (p0.412329). S2/S3 source-scope alternatives disagree (433.404 and417.162, both p0.00005). Current modifier applications and added skill-kind applications are counted separately in the trace artifacts. S2/S3 damage-kind restrictions remain unreviewed rather than being promoted from component omissions.

## Contradictions and weaker observations

- Archived `renee_same_kind_ahmose_damage_taken_up_strong_nc.json#0`:10000T6M vs300T6I+500T6L, gameA2810/current2574. This236-survivor residual remains material enough to investigate. Omission and tested scope/kind/delay alternatives do not provide a generally supported fix. Its weaker sibling5000M vs300I+100L gives1631/current1622; retain the9-unit residual with its larger scale and different troop-line lifecycle.
- Archived `renee_same_kind_hendrik_defense_down_nc.json#0`:57400T9M vs40 troops with the exact recorded T11/FC kit, gameA46014/current48221.448 SD638.778, p0.001 at1000 simulations. One simulated result was at least as low as the recorded count. The description's deterministic label is incorrect under hydrated troop chances. S2 broadening improves this lone observation to47897.575 SD720.943, p0.00945; that is insufficient to identify a universal fix and conflicts with stronger deterministic contexts. No recorded troop count, level or FC key was changed.
- Archived Jasser and Seo-yoon interactions give game791/current787 and1334/current1326 on8000-versus800 armies. Retain these4/8 residuals without declaring universal >2 failure. The archived Edith interaction gives4883/current4882. All selected omissions are much worse; none uniquely proves exact coefficient scaling.
- `ambusher_logan_renee_vs_logan_patrick_nc.json#0` has ten recorded A−D values2057,572,−2668,1547,2428,2199,−1731,1178,−1580,−2209: mean179.3/SD2006.636. Current mean−777.058/SD1876.285 (p0.154992) and immediate delivery638.707/SD1820.179 (p0.611219) are both plausible. It does not choose the delivery model. S1 omission gives−1735.127/SD1785.810, p0.0018, but the stronger deterministic cases carry the main claim. Trial2 explicitly conflicts: recorded totals A581/D9 versus class counts summing A590/D0. Primary totals and all contradictory metadata remain unchanged; no simulator sample has both sides alive, so score plausibility does not validate that exact pair.

Levels1/3/4 and sparse archived5 are present for S1, levels3/4 and sparse5 for S2/S3. Hydration is not positive validation of every level: the high-level archived FC disagreement remains unresolved. No joiner/widget scope, exact all-level coefficient curve, blocked-source timing, preparation snapshot or target-exhaustion behavior is certified here.

The older620T6L-versus920T6I Renee/Gwen gameA453 endpoint in `docs/renee-mechanic-investigation-2026-08.md` is also accepted recorded evidence. Its complete exact report input was not established in this bounded recovery, so it is documented outside the88 replayable entries. Neighboring search-script stats were not silently substituted. That source's other legacy broad-screen endpoints map to the recovered stash fixtures; old candidate predictions are not additional observations.
