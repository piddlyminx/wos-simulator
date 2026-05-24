import assert from "node:assert/strict";
import { test } from "node:test";

import { bucketCandidatesForJob, createEffectIndex, indexEffect } from "./effectIndex.js";
import { unitMask } from "./types.js";
import type { ActiveEffect, DamageJob } from "./types.js";

test("effect index returns bucket-tagged candidates from a direct job-shape lookup", () => {
  const index = createEffectIndex();
  const effect: ActiveEffect = {
    id: "effect-1",
    source: { kind: "hero_skill", side: "attacker", effectId: "boost" },
    intent: { id: "boost", type: "active.hero.damage.up", value: 25 },
    ownerSide: "attacker",
    kind: "modifier",
    valuePct: 25,
    appliesTo: { side: "attacker", units: unitMask("infantry") },
    appliesVs: { side: "defender", units: unitMask("lancer") },
    createdRound: 0,
    startRound: 0,
    duration: { type: "battle", value: 0 },
    uses: 0,
    stackingKey: "stack",
    sameEffectStacking: "add"
  };
  indexEffect(index, effect);

  const job: DamageJob = {
    id: "job-1",
    round: 1,
    kind: "normal",
    sourceIntentId: "intent-1",
    roundStartTroops: {
      attacker: { infantry: 100, lancer: 0, marksman: 0 },
      defender: { infantry: 0, lancer: 100, marksman: 0 }
    },
    attackerSide: "attacker",
    attackerUnit: "infantry",
    defenderSide: "defender",
    defenderUnit: "lancer"
  };

  assert.deepEqual(bucketCandidatesForJob(index, job), [{ effect, bucket: "active.hero.damage.up" }]);
});
