# Ahmose's paused attack: retrospective counter comparison

The actual skill description's “once every four times” does not choose a counter. This review freezes two explicit normal-attack interpretations against the current fixed-turn model, retaining all four accepted full-kit inputs. It changes no production file and adds no game observation. [Protocol](viper-cadence-protocol.json) records predictions before variant output; [results](viper-cadence-results.json) retains every complete trace.

Both attack variants schedule the one-turn pause and two-turn protection on the turn after their triggering normal attack. One triggers after every third normal attack, giving three attacks then a pause; the other triggers after every fourth, giving four attacks then a pause. Neither permits extra skill jobs to advance that trigger counter. Effects already created before source death keep their duration.

| Accepted case | Game attacker survivors | Current turns4,8,... | After3 normals | After4 normals |
|---|---:|---:|---:|---:|
|Archived strong,10000 Marksmen vs300I/500L|2810|2574|2709|2820|
|Archived weaker,5000 Marksmen vs300I/100L|1631|1622|1633|1645|
|Ahmose/Renee attacker,4000I/500L vs13400I|3777|3778|3778|3769|
|Ahmose solo|2633|2615|2640|2633|

All modeled battles end in attacker victory with no defenders; no draw is hidden by net scoring. After-three preserves the clean opposite-side case exactly and improves the two archived cases, as predicted, but the strong residual is still101. After-four brings the strong case within10 and the solo to exact agreement, while worsening the weaker case to14 and the clean opposite-side case to8. Those residuals must be judged at their army sizes; the comparison does not choose a universally exact model.

The result makes Viper's counter a useful investigation, but the same change alters both cadence and protection after Infantry die. All four cases initially contain Infantry, and no game round or attack chronology is available. A close endpoint therefore cannot identify which of those changes is right. Paul's current distinction between attack counters and fixed turn schedules remains the working model; this skill description's category is still ambiguous.

The earlier source-death traces found that Blade of Light expires rather than persisting indefinitely. A Renee packet calculated while its modifier is active can deliver later carrying the stored damage; that is distinct from newly applying the modifier after Infantry die. No Blade of Light or Renee repair follows this review.

A prospective Lancer-only full-kit Ahmose battle can discriminate fixed-turn protection without an Infantry source from interpretations requiring Infantry normal attacks. It does not by itself distinguish after3 from after4, nor prove what happens when a previously living source dies. Design a useful endpoint separation before capturing it.
