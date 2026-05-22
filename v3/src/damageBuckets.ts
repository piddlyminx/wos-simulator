import type { DamageKind } from "./types.js";

export type BucketRole = "attacker" | "defender";
export type BucketValueType = "raw" | "pct";

export interface BucketLeaf {
  role: BucketRole;
  valueType: BucketValueType;
  appliesTo?: DamageKind;
}

type BucketTree = {
  [key: string]: BucketLeaf | BucketTree;
};

export const BUCKETS = {
  troops: {
    count: { role: "attacker", valueType: "raw" },
    baseAttack: { role: "attacker", valueType: "raw" },
    baseLethality: { role: "attacker", valueType: "raw" },
    baseHealth: { role: "defender", valueType: "raw" },
    baseDefense: { role: "defender", valueType: "raw" }
  },
  player: {
    attack: { role: "attacker", valueType: "pct" },
    lethality: { role: "attacker", valueType: "pct" },
    health: { role: "defender", valueType: "pct" },
    defense: { role: "defender", valueType: "pct" }
  },
  passive: {
    attack: {
      up: { role: "attacker", valueType: "pct" },
      down: { role: "attacker", valueType: "pct" }
    },
    lethality: {
      up: { role: "attacker", valueType: "pct" },
      down: { role: "attacker", valueType: "pct" }
    },
    health: {
      up: { role: "defender", valueType: "pct" },
      down: { role: "defender", valueType: "pct" }
    },
    defense: {
      up: { role: "defender", valueType: "pct" },
      down: { role: "defender", valueType: "pct" }
    }
  },
  active: {
    hero: {
      attack: {
        up: { role: "attacker", valueType: "pct" },
        down: { role: "attacker", valueType: "pct" }
      },
      defense: {
        up: { role: "defender", valueType: "pct" },
        down: { role: "defender", valueType: "pct" }
      },
      lethality: {
        up: { role: "attacker", valueType: "pct" },
        down: { role: "attacker", valueType: "pct" }
      },
      health: {
        up: { role: "defender", valueType: "pct" },
        down: { role: "defender", valueType: "pct" }
      },
      damage: {
        up: { role: "attacker", valueType: "pct" },
        down: { role: "attacker", valueType: "pct" }
      },
      damageTaken: {
        up: { role: "defender", valueType: "pct" },
        down: { role: "defender", valueType: "pct" }
      }
    },
    troop: {
      attack: {
        up: { role: "attacker", valueType: "pct" },
        down: { role: "attacker", valueType: "pct" }
      },
      defense: {
        up: { role: "defender", valueType: "pct" },
        down: { role: "defender", valueType: "pct" }
      },
      lethality: {
        up: { role: "attacker", valueType: "pct" },
        down: { role: "attacker", valueType: "pct" }
      },
      health: {
        up: { role: "defender", valueType: "pct" },
        down: { role: "defender", valueType: "pct" }
      },
      damage: {
        up: { role: "attacker", valueType: "pct" },
        down: { role: "attacker", valueType: "pct" }
      },
      damageTaken: {
        up: { role: "defender", valueType: "pct" },
        down: { role: "defender", valueType: "pct" }
      }
    }
  },
  type: {
    normal: {
      damage: {
        up: { role: "attacker", valueType: "pct", appliesTo: "normal" },
        down: { role: "attacker", valueType: "pct", appliesTo: "normal" }
      },
      defense: {
        up: { role: "defender", valueType: "pct", appliesTo: "normal" },
        down: { role: "defender", valueType: "pct", appliesTo: "normal" }
      }
    },
    skill: {
      damage: {
        up: { role: "attacker", valueType: "pct", appliesTo: "skill" },
        down: { role: "attacker", valueType: "pct", appliesTo: "skill" }
      },
      defense: {
        up: { role: "defender", valueType: "pct", appliesTo: "skill" },
        down: { role: "defender", valueType: "pct", appliesTo: "skill" }
      }
    }
  },
  source: {
    extraSkill: { role: "attacker", valueType: "raw", appliesTo: "skill" }
  }
} as const satisfies BucketTree;

export interface BucketDefinition extends BucketLeaf {
  path: string;
}

export const BUCKET_DEFINITIONS = flattenBuckets(BUCKETS);
export const ATOMIC_BUCKETS = Object.keys(BUCKET_DEFINITIONS).sort();

export type AtomicBucket = string;
export type BucketName = AtomicBucket;

export function bucketDefinition(path: string): BucketDefinition | undefined {
  return BUCKET_DEFINITIONS[path];
}

export function isAtomicBucket(path: string): path is AtomicBucket {
  return path in BUCKET_DEFINITIONS;
}

function flattenBuckets(tree: BucketTree, prefix = ""): Record<string, BucketDefinition> {
  const buckets: Record<string, BucketDefinition> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isBucketLeaf(value)) buckets[path] = { ...value, path };
    else Object.assign(buckets, flattenBuckets(value, path));
  }
  return buckets;
}

function isBucketLeaf(value: BucketLeaf | BucketTree): value is BucketLeaf {
  return "role" in value && "valueType" in value;
}
