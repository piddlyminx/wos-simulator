import type { DamageKind } from "./types";

export type BucketRole = "attacker" | "defender";
export type BucketValueType = "raw" | "pct";
export type BucketUpdate = "assign_factor" | "add_pct_factor";
export type BucketPlacement = "numerator" | "denominator";
// "static" pools are closed at compile time (base/player/passive): every contributor is
// known at battle start, so they are aggregated once by the static damage profile.
// "dynamic" pools are open: triggered/timed/conditional effects can feed them per job,
// so they are aggregated in the per-job runtime scratch.
export type BucketPhase = "static" | "dynamic";

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
    count: { role: "attacker", valueType: "raw", update: "assign_factor", placement: "numerator" },
    baseAttack: { role: "attacker", valueType: "raw", update: "assign_factor", placement: "numerator" },
    baseLethality: { role: "attacker", valueType: "raw", update: "assign_factor", placement: "numerator" },
    baseHealth: { role: "defender", valueType: "raw", update: "assign_factor", placement: "denominator" },
    baseDefense: { role: "defender", valueType: "raw", update: "assign_factor", placement: "denominator" }
  },
  player: {
    attack: { role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
    lethality: { role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
    health: { role: "defender", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
    defense: { role: "defender", valueType: "pct", update: "add_pct_factor", placement: "denominator" }
  },
  passive: {
    attack: {
      up: { role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
      down: { role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "denominator" }
    },
    lethality: {
      up: { role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
      down: { role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "denominator" }
    },
    health: {
      up: { role: "defender", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
      down: { role: "defender", valueType: "pct", update: "add_pct_factor", placement: "numerator" }
    },
    defense: {
      up: { role: "defender", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
      down: { role: "defender", valueType: "pct", update: "add_pct_factor", placement: "numerator" }
    }
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
  phase: BucketPhase;
}

// A pool is closed at compile time (static phase) when no triggered/timed/conditional
// effect can feed it: base troop stats, player stat bonuses, and battle-start passives.
// Everything else is an open pool aggregated per damage job.
const STATIC_BUCKET_FAMILIES = ["troops.base", "player.", "passive."];

function phaseForPath(path: string): BucketPhase {
  return STATIC_BUCKET_FAMILIES.some((family) => path.startsWith(family)) ? "static" : "dynamic";
}

export const BUCKET_DEFINITIONS = flattenBuckets(BUCKETS);
// ATOMIC_BUCKETS is the runtime (open-pool) bucket set used by the per-job scratch and
// damage expression. Static-phase buckets are aggregated by the static damage profile and
// never enter the runtime scratch, so they are intentionally excluded here.
export const ATOMIC_BUCKETS = Object.keys(BUCKET_DEFINITIONS)
  .filter((path) => BUCKET_DEFINITIONS[path].phase === "dynamic")
  .sort();
export const STATIC_BUCKETS = Object.keys(BUCKET_DEFINITIONS)
  .filter((path) => BUCKET_DEFINITIONS[path].phase === "static")
  .sort();

export type AtomicBucket = string;
export type BucketName = AtomicBucket;

export function bucketDefinition(path: string): BucketDefinition | undefined {
  return BUCKET_DEFINITIONS[path];
}

export function isAtomicBucket(path: string): path is AtomicBucket {
  return path in BUCKET_DEFINITIONS;
}

export function isStaticPhaseBucket(path: string): boolean {
  return BUCKET_DEFINITIONS[path]?.phase === "static";
}

function flattenBuckets(tree: BucketTree, prefix = ""): Record<string, BucketDefinition> {
  const buckets: Record<string, BucketDefinition> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isBucketLeaf(value)) buckets[path] = { ...value, path, phase: phaseForPath(path) };
    else Object.assign(buckets, flattenBuckets(value, path));
  }
  return buckets;
}

function isBucketLeaf(value: BucketLeaf | BucketTree): value is BucketLeaf {
  return "role" in value && "valueType" in value && "update" in value && "placement" in value;
}
