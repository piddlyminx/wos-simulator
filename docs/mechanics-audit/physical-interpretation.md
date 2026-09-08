# Physical interpretation and residual diagnosis

Paul clarified this audit's working method on2026-09-07: keep the numbers connected to what they represent in a battle. Physical analogies help select meaningful patterns and reject implausible explanations. They guide testable hypotheses; they do not replace observed game behavior or establish the designers' intent.

The square-root army term has a useful **crowding** interpretation: more troops increase fighting capacity, with diminishing returns when limited space prevents every soldier from engaging effectively. This is a working explanation of the observed scaling, not a claim that the game explicitly simulates physical positions. Its dependence on the smaller initial army also raises a concrete question about engagement capacity established at battle start.

Fractional troop state represents accumulated attrition. A partly damaged surviving unit can keep fighting at full unit strength while still being worn down and eventually killed. Retaining fractional casualty state and using the ceiling of surviving source units for attack strength express those separate roles. Neither licenses an additional ceiling around an abstract square-root factor.

The outer-ceiling correction removed a shared source of mismatch that had obscured individual skills. On the same172 active deterministic entries, raw exact agreement on both sides rose from68 to118, without stat adjustment:52 became exact and2 lost exactness while remaining within two. The distribution of maximum per-observation side errors changed from68/40/14/50 to118/27/4/23 for exact/one/two/above-two. [The extracted counts and exact source hash](reviews/outer-army-ceil/exact-agreement-summary.json) preserve that comparison. Thresholds remain diagnostics, with Paul's battle-scale tolerance applied separately.

For remaining discrepancies, inspect what happens to the represented battle:

- Which troop line takes the unexplained damage, and when does the difference begin?
- Does the error appear at a pause, a skill activation, a line's death, or a queued attack's delivery?
- Which surviving unit could perform the action? Could already initiated work finish after its source is gone, and could new work begin?
- Does the effect represent a continuing formation, a temporary protection window, an attack carried by a particular troop class, or damage already committed earlier?
- Do the signs and scaling of the residual match the proposed cause across other battles, including the strongest counterexample?

Ahmose's pausing Infantry suggest a protective-screen analogy, but that does not establish a source-survival requirement. Paul subsequently explained the current understanding that fixed turn skills continue after their troop line dies. The proposed living-Infantry gate must therefore not be applied merely because it sounds physically plausible. First resolve the actual skill's attack-versus-turn wording and any specific contrary evidence. This is an example of an analogy yielding to the better-supported working model.

Subsequent prospective Ahmose captures supplied that specific evidence: no Infantry gives game defender11 versus old attacker15, and one Infantry exhausted early gives game attacker3 versus old61. Both agree exactly with no new Viper activations without Infantry. The [adopted source requirement](reviews/renee-ahmose-lifecycle/source-gate-adoption.md) follows those discriminators; it does not change source-less turn skills or settle Viper's ambiguous attack-versus-turn cadence. Protection already started keeps its duration in the retained implementation; these two captures do not directly test that later-expiry edge case.

Paul clarified the current counter model during this audit on2026-09-07, then explicitly qualified it as his best understanding and the community's current understanding:

- **Every N attacks:** the relevant troop line's normal attacks advance its proc counter. If stun, an exhausted target or another interruption prevents the normal attack, the counter waits. Extra skill attacks neither advance that counter nor roll additional attack-triggered skills.
- **Every N turns:** a fixed battle-turn schedule N,2N,3N; missing a scheduled opportunity does not defer it to the following turn. The schedule continues after the troop line dies. A scheduled effect and the ability to emit damage from a living source are separate questions.
- **Attack-based effect durations:** applicable normal attacks and extra skill attacks both consume uses. These duration counters are distinct from the normal-only proc counters.

Paul reports that implementing this separation brought several deterministic skill testcases to exact matches. This is useful reported empirical support, not a newly captured discriminator or a proof of every edge case. Retain the model while seeking specific contrary evidence. The inspected runtime already advances normal counters once per declared normal attack and charges applicable effects on both normal and generated damage jobs. Stored delayed damage charges its modifiers when calculated, without charging them again on delivery. That last calculation/delivery detail, per-target fanout consumption, and cancelled-attack effect consumption are implementation observations; the general model above does not independently settle them.

The default extra-skill effect lasts one turn and one applicable attack. Hendrik's scheduled extra attack therefore expires if unused on its scheduled turn; it does not wait indefinitely for a later normal attack. Six existing focused tests passed for these defaults, unused turn expiry, per-line normal cadence, paused counters and extra-job effect consumption. This checks implementation consistency, not live-game proof. No counter-runtime edit was necessary.

Hendrik's captured S3 skill description says every3 turns, while the historically adopted first2/every3 candidate improves recorded endpoints. The [2026-09-08 joint-count review](reviews/hendrik-count-consistency-2026-09-08/README.md) finds that the first report's S2/S3 counts5/6 cannot share a battle duration under S2 first4 and S3 first2 with ordinary reporting; the usual schedules fit both. The second report's11 S3 activations also allow first3 if the game lasts33–35 rounds, so treating the model's32-round duration as correct overstated the case for first2. The current file again uses first3. Its residual damage and survival errors remain unresolved; no global counter change or reporting exception follows from the historical endpoint fit.

A small per-hit percentage is not reassurance about materiality. It can shift a line's death, alter subsequent incoming attacks and skill timing, and change the whole outcome. Judge the complete trajectory and endpoint. A plausible story or an improved aggregate score alone is insufficient, particularly when a draw hides surviving troops on both sides.
