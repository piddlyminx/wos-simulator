# Core arithmetic adoption — 2026-09-07

Production now removes the outer ceiling from the square-root army term. Independent review found the code change matches the previously audited isolated candidate exactly. The original counterfactual [review](README.md), predictions and raw samples remain preserved; this note records subsequent adoption and fresh verification.

Two established game rules remain unchanged: **fractional survivor state persists between rounds**, and **attack strength uses the ceiling of the surviving source-unit count**. A surviving fraction can continue taking damage and eventually die; it is not rounded back to a whole unit in stored state. The removed ceiling was a separate operation applied after multiplying the two square roots:

```text
source count used for attack = ceilIgnoringFloatResidue(surviving source units)
army term = sqrt(source count used for attack) * sqrt(smaller initial army)
```

Source eligibility, target locking, damage factors, skills, the source-protection calculation and final report rounding retain their existing behavior. The attack-count ceiling is established behavior, not an unresolved candidate in this change. No hero definition was changed to fit the arithmetic results.

The reviewed production `damage.ts` SHA256 is `3265256260394c708116b727f677eff90c2ef2080558c6552f0e80b3447a4d84`; compiled config SHA256 remains `bcb0d3068845ca143802c6e59cd7a530a8440606133b770613c418bed425b17c`. [Adoption verification JSON](adoption.json) records exact test/source hashes and artifact checksums.

The whole-number test now permits machine-scale square-root residue while still rejecting a one-unit overcount. The new source `1.5`, initial army `3` test expects `sqrt(6)`, so it rejects both restoring the outer ceiling and removing the established inner source ceiling. The adjusted-sample test retains a positive adjustment bounded by `0.05`, distinct raw/adjusted predictions, exact adjusted parity and preserved comparison samples; removing its hardcoded fitted value avoids tying that tooling contract to one damage formula. No blocking correctness or test-weakening concern was found.

**Fresh verification:** all **210 unit tests pass**, and typecheck passes against the final reviewed test edit. The full production parity run executes **293 cases with zero runner errors**, using 1,000 stochastic samples and seed `mechanics-audit-2026-09-07-after-rounding`. All recorded game outcomes are accepted evidence unless explicitly flagged invalid or obsolete; folder location does not downgrade them.

The [raw parity extraction](production-parity.json) finds **23 of 174 deterministic rows still more than two troops away**, by both signed score and separate survivor totals. All 172 deterministic rows overlapping the frozen audit exactly reproduce its isolated candidate. The two newly included deterministic captures also agree: Hendrik defender 17 and Sonya defender 1175. This is not a claim that all mechanics or mismatches are resolved; two deterministic-classified fixtures also store varying outcomes.

Three stochastic rows fail the raw combined `p < 1/250` test in this fresh run: mixed-heroes row #2 (`p=0.0008`), Gatot S8 11548 (`0.00125`), and S8 25000 (`0.00005`). These are existing disagreements. Tail verdicts vary with Monte Carlo sampling: the earlier 10,000-sample candidate check gave S8 11548 `p=0.005`, while Hector/Renee/Wayne remains borderline (`0.00375` in that check, `0.00595` here). A threshold crossing alone does not close those distribution questions. Runner-adjusted PASS labels are not used to erase raw residuals.

A [separate production replay](adoption-check.json) matches all ten selected Wu/rounding observations exactly. In particular, the archived Wu result improves from defender 219 to observed **200**, while the newer capture remains **223**; the rounding follow-up is **180**, S2 isolation **40**, and Renee/Wu **359**. The [earlier Wu review](../wu-ming-2026-09-07.md) retains its original numbers and now labels the old 19-troop residual resolved by this core correction. That outcome does not establish unexercised Wu skill branches or bucket interactions.
