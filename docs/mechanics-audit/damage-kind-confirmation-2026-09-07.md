# Reina and Philly damage classification

On September7, during this audit, Paul explicitly confirmed:

> Reina S3 and Philly S2 are "skill" damage as I remembered.

Treat both as skill damage in the ongoing audit. This is a user-confirmed mechanic, separately attributed from the simulator definitions, skill description wording and newly captured battle endpoints. The current simulator already assigns both jobs the `skill` damage kind; this confirmation requires no production change.

The similar English descriptions use "extra" ambiguously. Damage amount, delivery as a separate hit, and modifier classification are separate questions. This confirmation does not establish a third `extra` kind, nor does the different numerical interpretation of the two skills require one.

The new [Reina magnitude comparisons](reviews/reina-extra-attack-magnitude/README.md) support120% additional damage at level1, conditional on the other modeled mechanics. The accepted [Philly comparisons](reviews/philly-dosage-interpretation/README.md) support140% total at level2, currently represented as normal100 plus skill40. Those endpoint comparisons do not independently identify every modifier interaction or damage-job lifecycle.

Preserve the already completed normal-kind counterfactuals as diagnostic history. They are not competing working classifications after Paul's confirmation, unless subsequent game evidence exposes a contradiction requiring review. No new battle observation is added by this note.
