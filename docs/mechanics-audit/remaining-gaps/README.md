# Remaining fixture-applicability gaps — 2026-09-07

There are **26 fixture-applicability gaps in scope**:21 ordinary skills on unowned heroes,3 locked ordinary skills and2 FC troop skills. Paul excludes the31 skill_4 widgets as separately validated in the [audit README](../README.md). The full inventory still contains57 nonempty definitions with zero hydrated fixtures, including those widgets. **No unlocked ordinary hero skill on either refreshed roster remains without fixture applicability.** That does not imply those skills' mechanics or all branches are supported: hydration only shows that the simulator attached the skill to an input.

| Category | Skills | Availability finding |
|---|---:|---|
| Ordinary skills on unowned heroes |21|Seven heroes absent from both complete refreshed rosters |
| Locked ordinary skills on owned heroes |3|Every available account records level0 for the selected skill |
| Widgets on owned heroes, outside audit |24|Equipment ownership/levels uninspected; no inspection needed for this audit |
| Widgets on unowned heroes, outside audit |7|Hero absent from both rosters; separately validated per scope clarification |
| Marksman FC skills |2|No FC3/FC8 Marksmen in the directly inspected available formations |

The21 unowned ordinary skills are all three slots of **Blanchette, Fred, Freya, Gregory, Jeronimo, Magnus and Xura**. Their exact configured skill IDs, source hashes and per-account ownership are listed in [classification.json](classification.json).

| Locked ordinary skill | minxxx full kit | WIP full kit |
|---|---|---|
| Greg S3 LawAndOrder |1/1/0|1/1/0|
| Natalia S3 CallOfTheWild |2/2/0|Hero absent|
| Sonya S3 TorrentialImpact |1/0/0|1/1/0|

For reference only, the ordinary three-slot skill cache does not record equipment availability. The24 owned-hero widgets have these configured modes; they are outside the audit:

| Configured mode | Owned heroes whose widget level is uninspected |
|---|---|
| Rally |Alonso, Gordon, Greg, Gwen, Hendrik, Mia, Natalia, Reina, Renee|
| Garrison |Ahmose, Bradley, Edith, Flint, Gatot, Hector, Logan, Lynn, Molly, Norah, Philly, Sonya, Wayne, Wu Ming, Zinman|

The other seven widgets belong to the seven absent heroes above. Every widget row retains its exact configured engagement requirement separately from its unknown equipment level. No widget is declared unavailable merely because `skill_4` is absent from `player_hero_skills.json`.

Crystal Gunpowder and Flame Charge remain separate from hero availability. [The direct Marksman inventory inspection](../reviews/marksman-fc-availability/README.md) found visible RomanIX/T9 Supreme Marksmen and lower tiers on both accounts, with no FC emblem. These current available formations cannot exercise the configuredFC3/FC8 skills. Their thresholds here come from config; no new FC skill unlock skill description was captured.

The ordinary rosters were refreshed in-game earlier on2026-09-07 (`skill/tmp/debug/hero_skills_minxxx_20260907T035615Z_00` and `skill/tmp/debug/hero_skills_WIP_20260907T035709Z_00`). The preserved [roster snapshot](roster-snapshot.json) and hashes identify the exact source used. Equipment inspection has not happened for this classification. Economic/empty definitions are excluded from these battle gaps.

Rerun from repository root after regenerating the main inventory:

```sh
python docs/mechanics-audit/remaining-gaps/classify.py /absolute/new-output-directory
```

Omitting the directory refreshes these generated JSON files. The script reads the current inventory/roster once and preserves their hashes. It does not run battles or update reviewed evidence. Continue reviewing positive and partial branches among already-hydrated skills; widget equipment inspection is not pending work under the current scope.
