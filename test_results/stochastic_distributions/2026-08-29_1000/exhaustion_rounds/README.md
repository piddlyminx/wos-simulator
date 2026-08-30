# Score histograms by unit-type exhaustion round

This targeted export traces 1000 samples for philly_bahiti_combo#1, wayne_s2_solo#0, s8-33510-t9-marksmen-vs-one-t1-fc10-infantry#0, s9-1500-t9-lancers-vs-146-t1-fc10-lancers#0, s9-2200-t9-lancers-vs-146-t1-fc10-lancers#0 using the same default testcase seed sequence as the stochastic distribution export.

- `exhaustion_round_histograms.html`: score bars stacked by exhaustion round at prefixes 500, 1000; spans up to 200 use exact integer bars, while broader spans use integer-aligned grouped bins.
- `sample_exhaustion_rounds.csv`: score, battle length, and every initially present formation's exhaustion round for each sample.
- `stacked_bar_counts.csv`: the colored contribution counts underlying each bar.
- `event_summary.csv`: variable exhaustion events ranked by the fraction of score variance separated by their round labels.

An exhaustion round is the last round whose start-of-round troop count is positive before the next round starts at zero. If exhaustion ends the battle, the final battle round is used. `survived` means the formation remained at the end.
