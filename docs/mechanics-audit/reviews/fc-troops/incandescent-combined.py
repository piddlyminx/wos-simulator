"""Replay the retrospective cross-setup IncandescentField comparison."""

import json
import random
import math
import sys
from pathlib import Path

directory = Path(__file__).resolve().parent
source = json.loads((directory / "results.json").read_text())
rows = [row for row in source["results"] if "/s9-" in row["key"]]
assert len(rows) == 6 and all(len(row["game"]) == 1 for row in rows)
draws, seed = 100_000, 202609071
models = {}
for name in ("current", "no_incandescent"):
    per_case, standardized = [], []
    for row in rows:
        samples = row["predictions"][name]["samples"]
        mean = sum(samples) / len(samples)
        sd = math.sqrt(sum((sample - mean) ** 2 for sample in samples) / (len(samples) - 1))
        observed = row["game"][0]
        per_case.append(dict(key=row["key"], observed=observed, mean=mean,
                             sd=sd, observedZ=(observed - mean) / sd))
        standardized.append([(sample - mean) / sd for sample in samples])
    observed_sum = sum(case["observedZ"] for case in per_case)
    rng = random.Random(seed)
    null = [sum(rng.choice(samples) for samples in standardized) for _ in range(draws)]
    lower = (1 + sum(value <= observed_sum for value in null)) / (draws + 1)
    upper = (1 + sum(value >= observed_sum for value in null)) / (draws + 1)
    models[name] = dict(observedSumStandardizedResiduals=observed_sum,
                        lowerTailP=lower, upperTailP=upper,
                        twoSidedP=min(1, 2 * min(lower, upper)), perCase=per_case)

result = dict(
    method="Retrospective conditional combined test for six distinct accepted Lancer setups. "
           "Statistic is sum of signed endpoint residuals standardized by each model-specific "
           "simulator mean/SD. Null draws independently resample one predicted endpoint per "
           "setup. Assumes the six game captures have independent battle RNG conditional on "
           "their recorded inputs; does not pool them as repetitions of one setup. "
           "No correction for adaptive historical case selection.",
    nullDraws=draws, nullSeed=seed, source="results.json", models=models)
if len(sys.argv) > 1:
    with Path(sys.argv[1]).open("x") as output:
        json.dump(result, output, indent=2)
        output.write("\n")
else:
    assert result == json.loads((directory / "incandescent-combined.json").read_text())
    print("Stored combined comparison reproduced exactly.")
