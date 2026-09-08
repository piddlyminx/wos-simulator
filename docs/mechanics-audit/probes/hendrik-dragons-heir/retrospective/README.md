# Hendrik timing review — 2026-09-07

**Retrospective:** both accepted game endpoints, the Marksman defender vector 313/82/76 and reported S2/S3 counts 5/6 were known before this diagnostic was defined or run. [diagnosis.json](diagnosis.json) preserves exact inputs, current source hashes, candidate definitions and per-job diagnostics; [diagnose.mts](diagnose.mts) applies each alternative to a cloned config. No production definition or live kit was altered.

Both battles preserve Hendrik 3/3/3. In the first, 100 no-hero T6 Lancers attack 150 Hendrik T6 Lancers; game leaves 17 defenders. In the second, 250 Hendrik T6 Marksmen attack 400 no-hero Infantry, 100 Lancers and 100 Marksmen; game leaves 471 defenders (313/82/76). The latter report records S2 five activations and S3 six, with 17 displayed kills. All recorded game outcomes are accepted evidence; report images are additionally preserved for these new captures.

| One isolated alternative | Lancer defenders | Marksman-battle defenders (I/L/M) | Marksman S2/S3 activations |
| --- | ---: | --- | --- |
| Current | 17 | 476 (314/84/78) | 5/6 |
| S2 delayed one round | 17 | 476 (314/84/78) | 5/6 |
| S2 duration one round | 5 | 480 (317/84/79) | 4/6 |
| S2 damage-taken bucket | 17 | 476 (314/84/78) | 5/6 |
| S2 first round 1, every 4 | 20 | 473 (312/83/78) | 5/6 |
| S3 first round 2, every 3 | 17 | **471 (313/82/76)** | **5/7** |
| S3 first round 4, every 3 | 17 | 479 (314/85/80) | 5/6 |
| S3 delivery delayed one round | 17 | 479 (314/85/80) | 5/6 |
| S3 normal damage kind | 17 | 476 (314/84/78) | 5/6 |
| S3 every third actual Marksman attack | 17 | 476 (314/84/78) | 5/6 |

The current five-survivor residual is about 1% of the 476 prediction, with per-line residuals 1/2/2. It is retained as unresolved and does not by itself establish a practically material simulator defect. The frozen target-only alternative leaves 516 (316/100/100): observed damage to both backlines behind surviving Infantry strongly supports multi-target delivery in this full kit.

Starting S3 on round 2 reproduces all three observed troop counts. Its scheduled rounds are 2/5/8/11/14/17/20; round 20 is terminal. The last activation emits approximately 0.2600/0.7408/0.9853 fractional kills, totaling 1.9861. A game report that excludes a terminal activation is a possible explanation for six displayed activations, but that reporting rule has not been established. Another attack or delivery phase could also affect damage and reporting. The exact vector fit therefore does not justify adopting the earlier phase. Current round-3 scheduling agrees with the activation count while retaining the small damage residual.

The S2 delay and bucket alternatives cannot explain the second endpoint difference at these inputs. Earlier S2 improves that endpoint but moves the first from 17 to 20; neither is an independent match across both battles. Shortened duration worsens the first battle substantially. Normal versus skill kind and turn versus actual-attack scheduling are indistinguishable here because neither battle contains a relevant kind modifier or attack interruption. In the Lancer-only battle, turn schedules can register internal S3 activations while emitting zero damage jobs; the report dashes do not establish how source-less scheduling is counted.

This diagnostic uses the adopted outer-army-term correction. Under that arithmetic, the first battle's delayed-S2 alternative predicts **17**, whereas the original frozen pre-correction replay predicted **16**; duration-one similarly changes from 4 to 5. Original forecasts remain preserved. Fractional survivor state persists, and attack strength still uses the established ceiling on surviving source units. Neither rule was varied.

Current Hendrik definition SHA256: `a46f49505d26ffd53f50d61992df44fa6ec323d58e281a261f265db0749c5e16`. Damage runtime SHA256: `3265256260394c708116b727f677eff90c2ef2080558c6552f0e80b3447a4d84`. Full config SHA256: `bcb0d3068845ca143802c6e59cd7a530a8440606133b770613c418bed425b17c`.

## Possible follow-up, conditional on captured stats

The bounded [12-formation screen](followup-screen-with-delay.json) suggests **250 T6 Marksmen with Hendrik 3/3/3 versus 150 Infantry / 60 Lancers / 60 Marksmen without heroes**. This is a proposal, not a frozen capture protocol. It uses the existing exact report stats and introduces no disabled live skills or control fixture.

| Candidate | Defender total (I/L/M) | Rounds |
| --- | --- | ---: |
| Current | 78 (19/34/25) | 32 |
| S3 first round 2 | 71 (16/32/23) | 32 |
| S2 first round 1 | 75 (16/34/25) | 32 |
| S2 delayed one round | 79 (20/34/25) | 31 |

The primary seven-survivor difference is about 9% of the current endpoint, with all three defending lines alive under each candidate. That is a more useful endpoint separation than five out of 476. It still contains a terminal activation under the earlier S3 phase, so per-line outcomes should carry the comparison rather than activation counts alone. Before treating this as ready for capture, freeze the runtime/config and candidate definitions and check displayed-stat precision sensitivity. A fresh report would then be replayed through those same frozen definitions. Exact kind, independent magnitude and level scaling require other evidence.
