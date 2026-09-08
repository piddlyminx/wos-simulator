# Compressed generated traces

These two generated JSON traces are stored as deterministic gzip files. Their original JSON files remain available in the working tree and are ignored by Git. All original bytes and filenames are preserved when restored; existing evidence links and replay scripts use those filenames.

| Original path | Original bytes | SHA256 |
| --- | ---: | --- |
| [reviews/alonso-bahiti-flint-2026-09-07/results.json](reviews/alonso-bahiti-flint-2026-09-07/results.json.gz) | 107754823 | `f3b6076310de2a0b6c405bfd8dc25887d8510a74082f3589772745c2f7df3437` |
| [reviews/renee-ahmose-lifecycle/viper-cadence-results.json](reviews/renee-ahmose-lifecycle/viper-cadence-results.json.gz) | 93347999 | `564f22552608925a21622fa3aeee7e88c017cc2d15401e9344f2777c00fa0a31` |

Restore from the repository root before following the original JSON links or replaying scripts that read these files. The commands skip an existing original and never overwrite it.

```sh
test -e 'docs/mechanics-audit/reviews/alonso-bahiti-flint-2026-09-07/results.json' || gzip -dc 'docs/mechanics-audit/reviews/alonso-bahiti-flint-2026-09-07/results.json.gz' > 'docs/mechanics-audit/reviews/alonso-bahiti-flint-2026-09-07/results.json'
test -e 'docs/mechanics-audit/reviews/renee-ahmose-lifecycle/viper-cadence-results.json' || gzip -dc 'docs/mechanics-audit/reviews/renee-ahmose-lifecycle/viper-cadence-results.json.gz' > 'docs/mechanics-audit/reviews/renee-ahmose-lifecycle/viper-cadence-results.json'
```

Verify the restored or existing files from the repository root:

```sh
sha256sum -c <<'SHA256'
f3b6076310de2a0b6c405bfd8dc25887d8510a74082f3589772745c2f7df3437  docs/mechanics-audit/reviews/alonso-bahiti-flint-2026-09-07/results.json
564f22552608925a21622fa3aeee7e88c017cc2d15401e9344f2777c00fa0a31  docs/mechanics-audit/reviews/renee-ahmose-lifecycle/viper-cadence-results.json
SHA256
```
