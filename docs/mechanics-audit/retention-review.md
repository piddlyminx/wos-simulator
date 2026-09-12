# What to retain

These records help collaborators understand how mechanics were decided. They are not a chain of proof that the work happened.

- Retain game images. Capturing them again is expensive, and an old battle cannot simply be recreated since game progress cannot be reversed.
- Retain exact game inputs and observations, preferably in the canonical testcase: heroes, skill levels, troop tiers/counts, stats, per-type casualties/survivors, skill activations and displayed skill kills. Preserve contradictory observations too.
- Retain a concise explanation of the alternatives, the comparison and the resulting decision or open question.
- Simulator output can be regenerated. Keep a small whole artifact when convenient; for anything larger than a few kilobytes, extract only the relevant results. Usually these are per-type survivors, total survivors, skill activation counts and skill casualties. Stochastic comparisons also need sample counts and distribution summaries.
- Full traces are temporary diagnostics. Retain a short excerpt only when it explains a particular finding. Put regenerated verbose output outside the repository.

The game exposes final totals, not detailed roumd-by-round trace info. Even the  number of rounds is not explicitly given, at best it can be inferred from the number of skill activations when they follow a predictable cadence. Full simulator traces cannot be compared directly with an unavailable game trace. Displayed skill kills may require normalization using the report's injury proportions before comparison with total simulated casualties.

## September 2026 cleanup

124 large generated JSON records were condensed into comparison summaries. Per-attack damage buckets, complete battle traces, repeated runtime configuration and individual simulated samples were removed. Relevant endpoints, activation/kill counts and distribution summaries remain. Three compressed output dumps were removed as well; the retained summaries replace them. All game inputs, captured observations and images were unchanged.

The directory decreased from about 842 MB to 232 MB; JSON decreased from 632 MB to 32 MB. The two 43 MB Gwen prediction files are about 11 KB each. Remaining larger files include corpus-wide comparison tables, the generated inventory, and historical configuration/input records; these are distinct from individual full battle traces.

The original scripts and full artifacts remain in Git. See [regeneration instructions](archives.md). Historical replay scripts use the original output schemas and must be run in that historical checkout; the JSON files marked `comparison_summary` are for reading, not substitutes for those scripts' full-output inputs. No history rewrite was performed.
