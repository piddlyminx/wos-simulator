# Crystal Gunpowder and Flame Charge: saved-source search

No complete battle evidence suitable for validating either skill was found in this bounded search on 7 September 2026. Existing high-FC screenshots are useful source leads, but the four inspected qualifying images contain troop/stat inputs without an endpoint and complete hero/setup information.

The simulator currently enables CrystalGunpowder at FC3 and FlameCharge at FC8 (`simulator/config/troop_skills.json`). That is the model's gate, not a finding about the game. These are fire-crystal mechanics; a T11 or T12 filename alone does not demonstrate their presence.

## Scope and exclusions

- Searched skill names and variants in JSON/text under `skill/tmp`, `dashboard/test_reports`, and `tmp/t11_fc0`: no named skill observation found.
- Inspected all 12 `skill/tmp/**/report_stats_parser_debug.json` files and six top-level decoded report JSONs containing troop details. Every recorded troop there has FC0.
- Inspected `tmp/t11_fc0/report_stats_cache.json`: its 11 entries use only T10/T11 keys without FC. This does not assert that every other image in that directory was reviewed.
- Used the 32 entries in `tests/fixtures/dashboard_report_expected.json` only to identify screenshot candidates efficiently. Twenty images have expected marksman FC values of at least 3. Four were then visually checked against the actual images; the other 16 remain unreviewed source leads.
- Also visually inspected `image.png`, `android.jpg`, `markslanc.png`, and the August-26 screenshot under `dashboard/test_reports`. None supplies relevant FC-marksman mechanics evidence. In particular, `markslanc.png` visibly shows infantry/lancers rather than marksmen, and `android.jpg` shows T11 without FC badges.

No simulator output was counted as a game observation. No emulator was accessed, and no capture tooling or testcase was changed. This is not an exhaustive visual review of the 4,445 PNGs under `skill/tmp` or of other repository directories.

## Visually checked qualifying sources

| Screenshot under `dashboard/test_reports` | Observed marksmen | Why it cannot currently validate a mechanic |
|---|---|---|
| `Screenshot 2026-04-15 074256.png` | Left: 70,124 T11 FC8; right: 54,537 T10 FC6 | Troop counts/stat bonuses only; missing outcome and full battle setup |
| `Screenshot 2026-04-20 050746.png` | Right: 127,047 T11 FC8 | Troop counts/stat bonuses only; mixed infantry tiers on the right also require careful reconstruction |
| `Screenshot 2026-04-20 050818.png` | Left: 713,921 T11 FC8; right: 97,162 T11 FC8 | Troop counts/stat bonuses only; missing outcome and full battle setup |
| `t12_skills.jpg` | Left: 328,080 T10 FC7; right: 574,631 T10 FC9 | No endpoint, full heroes, or activation counts; visible troop labels are T10 despite the filename |

The complete candidate list, image hashes, review status, and parsed-cache inventories are preserved in [marksman-fc-source-candidates.json](marksman-fc-source-candidates.json). The troop values for the four reviewed candidates were checked visually; entries marked unreviewed are parser-test expectations, not new confirmations.

The next useful evidence is a linked complete report/setup for one of these source images, or a new controlled battle using confirmed available FC marksmen. Preserve the exact troop/FC keys and complete hero kits. These screenshots do not justify assigning evidence-supported status to either skill or modifying either mechanic.

## Gwen picker follow-up

The parent live run eventually found Gwen after approximately 17 swipes. The inspected `dispatch.py` path searches `Gwen.png` in the picker crop (x=0–720, y=560–940) at threshold 0.75, reverses direction after an unchanged scroll, and permits 30 swipes. It contains no explicit hero-class filter operation. The successful match is consistent with that traversal and supplies no evidence of a template/filter defect. No picker fix was made.
