"""Plot the frozen, matched-seed Reina forecasts and five recorded battles."""

import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np


root = Path(__file__).resolve().parent
results = json.loads((root / "results.json").read_text())
observed = np.array([166, 163, 163, 157, 174])
fig, ax = plt.subplots(figsize=(8.2, 4.5), layout="constrained")
for name, label, color in [
    ("current_extra20", "Previous simulator: 20% extra attack", "#a65349"),
    ("base_attack_plus20", "Corrected simulator: 120% extra attack", "#247b9e"),
]:
    values = np.array([-row["score"] for row in results["candidates"][name]["samples"]])
    ax.hist(values, bins=np.arange(135.5, 186.5), weights=np.full(len(values), 1 / len(values)),
            histtype="stepfilled", alpha=0.4, color=color, label=label)

for i, value in enumerate(observed):
    ax.scatter(value, -0.012 - i * 0.006, marker="|", s=120, linewidths=2,
               color="#202b35", label="Recorded game outcomes: 166, 163, 163, 157, 174" if i == 0 else None)
ax.axhline(0, color="#aaaaaa", linewidth=0.6)
ax.set(xlabel="Defending survivors (250 started)", ylabel="Simulated probability per survivor count",
       title="Reina Shadow Blade: in-game 120% damage resolves the mismatch",
       xlim=(135, 187), ylim=(-0.045, None))
ax.set_yticks([0, 0.05, 0.1, 0.15, 0.2], ["0%", "5%", "10%", "15%", "20%"])
ax.spines[["top", "right"]].set_visible(False)
ax.legend(frameon=False, loc="upper left", fontsize=9)
fig.supxlabel("2,048 simulations per model; full Reina 1/1/1 kit and identical report stats.\n"
              "The first game result was known before these forecasts; the other four were unread by the reviewer.",
              fontsize=8, color="#555555")
fig.savefig(root / "distribution.png", dpi=180)
fig.savefig(root / "distribution.svg")
