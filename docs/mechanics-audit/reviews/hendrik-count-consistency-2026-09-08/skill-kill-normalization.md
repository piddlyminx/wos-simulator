# Hendrik S3 skill-kill normalization

Paul clarified that the game's skill-kill display counts severely injured casualties in these battles. Compare it with the simulator's total fractional skill casualties by dividing the displayed figure by the recipient army's observed severely injured fraction. This interpretation was supplied after the recorded battle outcomes were known; it is not an independently discovered or prospectively tested reporting rule.

Both reports have zero dead troops. Total casualties equal initial troops minus survivors, and equal severely injured plus lightly injured.

| Defender formation | Total casualties | Severely injured | Lightly injured | Severe fraction | Displayed S3 kills | Estimated total S3 casualties | Simulator S3 casualties |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 400I/100L/100M | 129 | 47 | 82 | 47/129 = 36.4341% | 17 | 17 × 129/47 = 46.6596 | 45.2578 |
| 150I/60L/60M | 202 | 72 | 130 | 72/202 = 35.6436% | 27 | 27 × 202/72 = 75.7500 | 71.1391 |

The normalized S3 differences are approximately 1.40 and 4.61 casualties, respectively. Activation counts are game/simulator 6/6 and 11/10. Applying the same observed severe fraction to the simulator totals gives 16.4893 and 25.3565, versus displayed 17 and 27.

Inputs come from the current fixtures' `metadata.observed_battle_outcomes[0].defender` and S3 `displayed_kills`. Simulator values come from the nominal current-engine results in [stat-precision.json](stat-precision.json). The integer game displays and use of an army-wide injury proportion make these normalized values estimates, not exact fractional observations. They do not uniquely attribute the complete endpoint residual to S3.
