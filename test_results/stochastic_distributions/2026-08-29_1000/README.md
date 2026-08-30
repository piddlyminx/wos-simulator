# Stochastic testcase outcome distributions

This export contains 1000 seeded simulator outcomes for every testcase whose runtime reports stochastic mechanics. It uses raw testcase inputs and does not apply the parity runner's later stat adjustment.

- `outcomes.csv`: every signed integer score in run order.
- `checkpoint_summary.csv`: mean, SD, exact-score support, and empirical CDF distance from the complete 1000-outcome distribution at prefixes 10, 25, 50, 100, 250, 500, 1000.
- `shape_overview.csv`: one sortable shape summary per testcase.
- `exact_frequencies.csv`: exact integer score counts at every prefix; use this to inspect genuine steps and gaps.
- `binned_histograms.csv`: exact integer bins for spans up to 200; broader spans use approximately 40 equal-width, integer-aligned bins.
- `histograms.html`: searchable visual comparison of the prefix histograms.
- `manifest.json`: run parameters and provenance notes.

The checkpoints are prefixes of one sequence, not independent reruns. More simulator samples reveal the simulator distribution more completely; the derived checkpoints do not add independent evidence.
