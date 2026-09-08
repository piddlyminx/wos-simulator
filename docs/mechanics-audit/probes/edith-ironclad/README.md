# Edith Ironclad positive Infantry probe — 2026-09-07

**Captured once: game and fresh-stat simulator both leave102 defenders.** The battle displayed07:51:41 at791,577. The full333 kit,100 T6 Infantry/400 T6 Marksmen and all24 report stats were visually verified; no fresh-input correction was required. [Observation and image hashes](capture-01/observation.json) preserve the one battle, with counterpart mail2734692464125008 and its [winning troop table](capture-01/defender-troops.png). The counterpart is not a second observation.

Fresh Edith Infantry stats are529.9 Attack/522.1 Defense/244.0 Lethality/238.4 Health, adding221.7/221.6 Attack/Defense to the nohero conditional input. The [frozen-model replay](capture-01/replay.json) gives currentD102, S2 omittedD146, S3 omittedD155, S2 into HealthD108, and S2 into DefenseD102. All256±0.05 corners retain currentD102; the omission gaps are substantial for this500-troop setup. This supports both tested Infantry contributions conditional on the full kit, while leaving general bucket identity unresolved. The143 rounds are simulated; the game did not display a round count.

The [three captured skill pages](hero-tooltips/reviewed-transcription.json) confirm the actual333 levels and all configured displayed curves. S2 shows12% Infantry protection atLv3 (4/8/12/16/20); S3 shows15% Health for all troops (5/10/15/20/25). The other levels are UI evidence, not additional battles. All three Battle Details rows display triggered1/killsdash; S1 has no deployed recipient, so its displayed activation is not positive contribution evidence. Both sides have zero losses; the defender's sole Marksman row shows kills35/injured−105/lightly193/survivors102.

No simulator change or follow-up control is needed for this result. The parent independently ran the current production testcase runner: [validation log](production-validation.log) and [summary](production-validation.json) also give rawD102, without stat adjustment, errors or warnings. The original design and conditional forecasts below remain preserved.

One deterministic battle: **minxxx full Edith3/3/3 with100 T6 Infantry attacks WIP nohero400 T6 Marksmen**. Both existing accepted Edith fixtures deploy only Marksmen or Lancers: they never positively exercise Ironclad. This formation also exercises Steel Sentinel on an Infantry recipient.

S1 has no Infantry recipient; S2 reduces incoming damage by12%, and S3 grants15% Health. The solo widget gate is inactive. The full actual kit remains intact, with no joiners or higher-tier/FC effects. T6 normal Infantry and Marksman behavior remains enabled. There is no reason to collect a separate default control.

Fresh Edith Infantry stats were **unknown before capture**. The frozen `estimated-input.json` uses recently observed nohero Infantry308.2/300.5/244.0/238.4 from the minxxx side of the first Reina report. `historical-edith-input.json` instead uses accepted Edith333 report Infantry493.0/481.8/273.9/296.7 from `wos444_edith_s11_mark_damage_taken_hero_nc.json::0`; the second old Edith fixture has the same block. Its displayed owner name differs by one trailing x from the latest minxxx name, so that historical block is not asserted to be a current same-account measurement. WIP Marksman217.5/210.6/181.4/177.0 is the fresh observed block from the Reina report, whose selected Lancer hero did not change Marksman generation stats.

| Frozen conditional input | Current | Omit S2 | S2 into Health | S2 into Defense | Omit S3 |
|---|---:|---:|---:|---:|---:|
| Fresh nohero Infantry block | D296 | D308 | D297 | D296 | D310 |
| Historical Edith Infantry block | D33 | D101 | D45 | D33 | D113 |

`D` means defending WIP Marksman survivors. All256 corners of the eight used displayed stats at±0.05 give D296 for the first current forecast, and D33–35 for the historical current forecast. These corner checks are sensitivity screens, not a complete non-monotonic envelope. Hypothetical+80/+160/+240 Infantry Attack/Defense scenarios also retain substantial S2 omission gaps19/29/53; those are design scenarios, not measured hero bonuses or bounds on the fresh stats. The original50-formation screen is under `tmp/mechanics-audit-2026-09-07/edith-ironclad/`.

After capture, verify full actual kit, exact T6 counts, complete report stats, both survivor counts and Battle Details. Replay the same frozen candidates using the exact reported input; never add generation again. Preserve a mismatching observation and examine its actual-stat forecast before considering any further capture. An endpoint match would support Ironclad's level3 contribution conditional on the rest of this kit, and S3's positive Infantry contribution. It would not uniquely identify the bucket: the Defense alternative is algebraically/endpoint-equivalent in these sole-protection inputs. Nor does the single Infantry line establish exclusions for other recipients, every level, skill-kind incoming attacks or widget behavior.

The package was frozen before any new Edith Infantry outcome. It archives current runtime/config explicitly; a later Hendrik config correction does not change these forecasts. The current runtime archive differs from the earlier Reina archive only in the unrelated Gatot testcase export tool. `manifest.json` hashes original inputs/spec/config/archive; `runtime-manifest.json` hashes each source file. Original predictions remain immutable. Their effect-application keys contain `undefined` for damage kind because of a diagnostic field-name typo; the replay helper now reads `job.kind`. That correction does not affect the frozen endpoints or simulations.

```sh
npx --yes tsx docs/mechanics-audit/probes/edith-ironclad/predict.mts /absolute/captured-input.json /absolute/new-output.json
```

The helper verifies all frozen assets, rejects changed full kits/troops and existing output paths, then extracts the archive. It labels later supplied-stat runs as replays without claiming their outcome is unseen. Its predicted round counts are simulator outputs, not in-game observations.
