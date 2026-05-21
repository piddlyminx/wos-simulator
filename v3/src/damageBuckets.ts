export const NUMERATOR_BUCKETS = [
  "army",
  "attackBase",
  "lethalityBase",
  "attackUp",
  "lethalityUp",
  "runtimeAttackUp",
  "runtimeLethalityUp",
  "outgoingDamageUp",
  "defenseDown",
  "healthDown",
  "incomingDamageUp",
  "normalDamageUp",
  "normalDefenseDown",
  "skillDamageUp",
  "skillDefenseDown",
  "extraSkillSource"
] as const;

export const DENOMINATOR_BUCKETS = [
  "healthBase",
  "defenseBase",
  "attackDown",
  "lethalityDown",
  "outgoingDamageDown",
  "defenseUp",
  "healthUp",
  "runtimeDefenseUp",
  "runtimeHealthUp",
  "incomingDamageDown",
  "normalDamageDown",
  "normalDefenseUp",
  "skillDamageDown",
  "skillDefenseUp"
] as const;

export type NumeratorBucket = (typeof NUMERATOR_BUCKETS)[number];
export type DenominatorBucket = (typeof DENOMINATOR_BUCKETS)[number];
export type BucketName = `numerator.${NumeratorBucket}` | `denominator.${DenominatorBucket}`;
