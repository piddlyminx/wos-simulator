import type { DamageKind } from "./types";

export type BucketRole = "attacker" | "defender";
export type BucketValueType = "raw" | "pct";
export type BucketUpdate = "assign_factor" | "add_pct_factor";
export type BucketPlacement = "numerator" | "denominator";

export interface BucketLeaf {
  role: BucketRole;
  valueType: BucketValueType;
  update: BucketUpdate;
  placement: BucketPlacement;
  appliesTo?: DamageKind;
}

type BucketTree = {
  [key: string]: BucketLeaf | BucketTree;
};

export const BUCKETS = {
  troops: {
    count: { role: "attacker", valueType: "raw", update: "assign_factor", placement: "numerator" }
  },
  active: {
    hero: {
      attack: {
        up: { role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
        down: { role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "denominator" }
      },
      defense: {
        up: { role: "defender", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
        down: { role: "defender", valueType: "pct", update: "add_pct_factor", placement: "numerator" }
      },
      lethality: {
        up: { role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
        down: { role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "denominator" }
      },
      health: {
        up: { role: "defender", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
        down: { role: "defender", valueType: "pct", update: "add_pct_factor", placement: "numerator" }
      }
    },
    troop: {
      attack: {
        up: { role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
        down: { role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "denominator" }
      },
      defense: {
        up: { role: "defender", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
        down: { role: "defender", valueType: "pct", update: "add_pct_factor", placement: "numerator" }
      },
      lethality: {
        up: { role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
        down: { role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "denominator" }
      },
      health: {
        up: { role: "defender", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
        down: { role: "defender", valueType: "pct", update: "add_pct_factor", placement: "numerator" }
      }
    }
  },
  type: {
    normal: {
      damage: {
        up: { role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "numerator", appliesTo: "normal" },
        down: { role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "denominator", appliesTo: "normal" }
      },
      defense: {
        up: { role: "defender", valueType: "pct", update: "add_pct_factor", placement: "denominator", appliesTo: "normal" },
        down: { role: "defender", valueType: "pct", update: "add_pct_factor", placement: "numerator", appliesTo: "normal" }
      }
    },
    skill: {
      damage: {
        up: { role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "numerator", appliesTo: "skill" },
        down: { role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "denominator", appliesTo: "skill" }
      },
      defense: {
        up: { role: "defender", valueType: "pct", update: "add_pct_factor", placement: "denominator", appliesTo: "skill" },
        down: { role: "defender", valueType: "pct", update: "add_pct_factor", placement: "numerator", appliesTo: "skill" }
      }
    }
  },
  source: {
    extraSkill: { role: "attacker", valueType: "raw", update: "assign_factor", placement: "numerator", appliesTo: "skill" }
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
  return "role" in value && "valueType" in value && "update" in value && "placement" in value;
}
