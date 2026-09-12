# Regenerating simulator diagnostics

Full simulator output is temporary. The retained JSON records are comparison summaries; original traces, individual simulated samples and their old schemas can be recovered or regenerated when needed.

Revision `fadcab736804e84d8cae6db4b24c769c86e15be6` contains the audit immediately before the output cleanup, including original experiment scripts, inputs, candidate configurations and historical runtime snapshots. It is the recovery revision, not a claim that every experiment used the production configuration at that revision. Follow the individual experiment's notes for its tested variants and original runtime.

To inspect or rerun an old experiment without changing the active checkout:

```sh
git worktree add --detach /tmp/wos-audit-replay fadcab736804e84d8cae6db4b24c769c86e15be6
```

Use that checkout's package instructions and dependencies. Old helper scripts and checksum checks expect the original artifacts, not the condensed JSON in the current tree. Write any regenerated output outside the main checkout. No permanent trace archive is required for a new investigation: retain the relevant comparison and the source revision instead.

The former compressed Alonso/Bahiti/Flint and Ahmose Viper dumps are replaced by their `results.json` summaries. The Hendrik trait follow-up is summarized in [trait-summary.json](reviews/hendrik-count-consistency-2026-09-08/trait-summary.json). Their complete archived versions remain in the recovery revision if necessary.
