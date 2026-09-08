# Hendrik S3: joint activation counts challenge the round-2 start

**Subsequent full-trace review:** [carrying the normal attack's native troop matchup bonus into S3](trace-review.md) reproduces both Hendrik survivor vectors and both activation counts with the ordinary first3 schedule. Applying this rule globally worsens three existing Gwen mismatches. The hypothesis remains unresolved; no production rule or Hendrik-only exception was added.

Paul clarified that the decision bar is the most probable explanation, not proof. Earlier S3 timing has real positive endpoint evidence, including a prospectively predicted improvement in the second Marksman battle. The stronger objection is that an every-three-turn skill starting on turn2 conflicts with both the ordinary counter model and the two reported skill counts together.

The original saved Battle Details images were reread independently: first Marksman report S1/S2/S3=1/5/6, small report=1/8/11. The first game's exact survivor fit under first2 has seven simulated S3 activations, not eight. Actual game round counts remain unknown.

Assume complete, consistently counted scheduled activations and retain S2 first4/every4. These are conditional constraints on game duration:

| Report | S2-compatible turns | S3 first3-compatible turns | S3 first2-compatible turns |
|---|---|---|---|
|471 survivors; S2=5, S3=6|20–23|18–20|17–19|
|68 survivors; S2=8, S3=11|32–35|33–35|32–34|

For the first report, the ordinary schedules intersect at20; first2 has no intersection. For the second report, both candidates have an intersection. Its11 S3 activations therefore do not independently favor first2: the earlier interpretation imported the simulator's32-round duration into the game. First3 is compatible if the game lasts33–35 rounds. Changing S2 phase or introducing a reporting exception could alter these constraints, but neither is independently established here.

The original first2 survivor improvements remain valid:476→471, with exact313/82/76, and78→71 versus game68. Both first2 simulations have an S3 activation in their final round. A uniform rule omitting terminal activations would fix the first count while breaking the second. These facts favor keeping the ordinary3/6/9 schedule as the working model and investigating the remaining damage or survival discrepancy, rather than treating the exact first endpoint as confirmation of first2.

## Bounded retrospective checks

The [protocol](protocol.json) records predictions, input/source hashes and two additional named alternatives before their new simulation results. All game outcomes were already known. No coefficients, game inputs or production files were changed. The original29-file frozen runtime was verified and copied into temporary engines for each candidate.

| Candidate | Lancer game17 | Marksman game471; S3=6 | Small game68; S3=11 |
|---|---:|---:|---:|
|Ordinary first3|17|476;6|78;10|
|Historical first2|17|471;7|71;11|
|First3, previous-round source strength|17|473;6|75;10|
|First3, skill before accompanying normal attack|17|476;6|78;10|

The previous-source candidate represents Marksman strength committed one turn before damage delivery, retaining the inner troop ceiling and fractional casualty state. Constant offensive modifiers in these probes allow the source-strength contrast without a separate modifier-snapshot implementation. It is a hypothesis, not an observed preparation mechanic. It brings the first battle within two survivors while retaining the correct count, but leaves the second seven survivors away with one too few activations. It is not an identified replacement correction. Moving the skill before its normal attack has no effect in these formations.

[Results](results.json) retain all generated S3 jobs and damage traces. [Current production replay](current-replay.json) independently reproduces the ordinary-first3 endpoints and skill reports for all three cases. The current definition already lacked `first: 2` when this review began; this review did not remove it. The first2 adoption and earlier forecasts remain preserved as historical evidence.

Remaining work is to explain the Marksman damage/survival residual while comparing both survivor vectors and both skill counts. The most-probable standard does not require unique identification, but the reporting contradiction and ordinary cadence expectation must carry weight alongside exact endpoint agreement.
