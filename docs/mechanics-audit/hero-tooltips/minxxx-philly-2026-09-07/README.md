# Philly Expedition text, September 7

Root visually reviewed all three saved panel images. The targeted capture preserved Philly's2/2/2 kit and did not change levels. `tooltips.json` retains raw OCR, current levels and image hashes.

| Skill | Displayed level-2 behavior and curve |
| --- | --- |
| Vigor Tactics | All troops gain6% Attack and4% Defense; curves3/6/9/12/15% and2/4/6/8/10%. |
| Dosage Boost | All troops' attacks have a25% chance of dealing140% damage; curve120/140/160/180/200%. |
| Energizing Shot | A40% chance of reducing all troops' Damage Taken by20%; curve10/20/30/40/50%. This corresponds to the simulator's `NumbingSpores` definition. |

Paul raised the important possibility that the displayed120–200% includes the ordinary100% attack. The simulator currently treats Dosage Boost as an additional20–100% skill damage job. Its accepted battles must discriminate that interpretation from an additional120–200% job and from augmenting the original normal job.

Reina's text explicitly describes an extra Lancer attack, whereas Philly's describes an attack dealing a percentage. Wording and translation alone do not establish different mechanics. The five new Reina battles favor the additional120% level-1 model conditional on the other modeled mechanics; higher-level Reina battle behavior remains untested. The different scopes also matter for Paul's typical20–25% whole-army contribution heuristic: Reina affects Lancers, while Philly affects all troop classes. An average50% increase to a troop class responsible for half the damage would increase total damage by about25%, subject to the actual damage modifiers and battle feedback.
