type LuaInteger = number | bigint;

const MASK64 = (1n << 64n) - 1n;
const MIN_INTEGER = -(1n << 63n);
const MAX_INTEGER = (1n << 63n) - 1n;
const FLOAT_SCALE = 1 / 9007199254740992;

function integer(value: LuaInteger): bigint {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new RangeError("Use bigint for integers outside JavaScript's safe integer range");
  }
  const result = BigInt(value);
  if (result < MIN_INTEGER || result > MAX_INTEGER) {
    throw new RangeError("Integer is outside Lua's signed 64-bit range");
  }
  return result;
}

function rotateLeft(value: bigint, bits: bigint): bigint {
  return ((value << bits) | (value >> (64n - bits))) & MASK64;
}

/** Lua 5.4 math.random with 64-bit integers and double-precision floats. */
export class LuaRandom {
  private state0 = 0n;
  private state1 = 0n;
  private state2 = 0n;
  private state3 = 0n;

  constructor(seed: LuaInteger, secondSeed: LuaInteger = 0) {
    this.randomseed(seed, secondSeed);
  }

  randomseed(seed: LuaInteger, secondSeed: LuaInteger = 0): [bigint, bigint] {
    const first = integer(seed);
    const second = integer(secondSeed);
    this.state0 = first & MASK64;
    this.state1 = 0xffn;
    this.state2 = second & MASK64;
    this.state3 = 0n;
    for (let i = 0; i < 16; i++) this.nextUint64();
    return [first, second];
  }

  random(): number;
  random(upper: 0): bigint;
  random(upper: bigint): bigint;
  random(upper: number): number | bigint;
  random(lower: number, upper: number): number;
  random(lower: bigint, upper: bigint): bigint;
  random(lower: LuaInteger, upper: LuaInteger): number | bigint;
  random(lowerOrUpper?: LuaInteger, upper?: LuaInteger): number | bigint {
    let value = this.nextUint64();
    if (lowerOrUpper === undefined) return Number(value >> 11n) * FLOAT_SCALE;

    const lower = upper === undefined ? 1n : integer(lowerOrUpper);
    const high = integer(upper === undefined ? lowerOrUpper : upper);
    if (upper === undefined && high === 0n) return BigInt.asIntN(64, value);
    if (lower > high) throw new RangeError("interval is empty");

    const span = high - lower;
    let offset: bigint;
    if ((span & (span + 1n)) === 0n) {
      offset = value & span;
    } else {
      let mask = span;
      mask |= mask >> 1n;
      mask |= mask >> 2n;
      mask |= mask >> 4n;
      mask |= mask >> 8n;
      mask |= mask >> 16n;
      mask |= mask >> 32n;
      while ((offset = value & mask) > span) value = this.nextUint64();
    }
    const result = lower + offset;
    return typeof lowerOrUpper === "bigint" || typeof upper === "bigint" ? result : Number(result);
  }

  private nextUint64(): bigint {
    const state0 = this.state0;
    const state1 = this.state1;
    const state2 = this.state2 ^ state0;
    const state3 = this.state3 ^ state1;
    const result = (rotateLeft((state1 * 5n) & MASK64, 7n) * 9n) & MASK64;
    this.state0 = state0 ^ state3;
    this.state1 = state1 ^ state2;
    this.state2 = state2 ^ ((state1 << 17n) & MASK64);
    this.state3 = rotateLeft(state3, 45n);
    return result;
  }
}
