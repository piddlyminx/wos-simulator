# Gwen Expedition text, September 7

Root visually reviewed all three saved panel images after the targeted capture completed. The hero remained Gwen with the same 3/1/1 Expedition kit used in the three accepted battles. No levels were changed. `tooltips.json` retains unreviewed OCR and image hashes; these notes record the separate visual review.

| Skill | Current text and upgrade curve | Comparison with the definition |
| --- | --- | --- |
| Eagle Vision, level 3 | Increases the target's Damage Taken by 15%; curve 5/10/15/20/25%. | Magnitude matches. Text gives no attack-count duration, delay, or consumption rule; those implementation choices still require battle evidence. |
| Air Dominance, level 1 | All troops' attacks deal 20% extra damage after every five attacks; the target receives 5% extra damage on its next attack received. Curves 20/40/60/80/100% and 5/7.5/10/12.5/15%. | Magnitudes and textual description match. The exact first activation, counter reset, extra-hit classification and mark lifecycle are not established by this wording alone. |
| Blastmaster, level 1 | Marksmen deal 10% extra damage to all enemies on the next attack of every four attacks; curve 10/20/30/40/50%. | Magnitude and textual description match. The exact cadence and fanout modifier consumption remain unresolved by the three battles. |

Unlike the independently found Reina coefficient error, these captures reveal no copied numerical discrepancy. They support the displayed curves, not a claim that the corresponding mechanics reproduce the game. See the [three-battle diagnosis](../../reviews/gwen-preparation-snapshot/post-capture/README.md).

This is the first live validation of the command now named `capture-hero-skill-details`: the command found the requested hero, preserved its levels, selected the three Expedition icons, and saved distinct full screenshots, panel crops, visible previews and a completed manifest. It does not create a battle observation.
