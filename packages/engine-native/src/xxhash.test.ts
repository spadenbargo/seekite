import { describe, expect, it } from "vite-plus/test";

import { isSupported, xxhash64 } from "./index.js";

/**
 * XXH64 correctness.
 *
 * Spec 06 keys the incremental-build cache on these hashes, so a wrong (or
 * merely *different*) implementation means stale artifacts served as fresh.
 * Two independent checks:
 *
 * 1. Published test vectors, so the implementation is anchored to something
 *    outside this repo.
 * 2. A from-the-spec reference implementation below, cross-checked over every
 *    input length that changes which branch of the tail loop runs (the 32-byte
 *    striped body, the 8/4/1-byte tails, and the `len < 32` short path).
 */

const MASK = (1n << 64n) - 1n;
const P1 = 11400714785074694791n;
const P2 = 14029467366897019727n;
const P3 = 1609587929392839161n;
const P4 = 9650029242287828579n;
const P5 = 2870177450012600261n;

const mul = (a: bigint, b: bigint) => (a * b) & MASK;
const add = (a: bigint, b: bigint) => (a + b) & MASK;
const rotl = (v: bigint, n: bigint) => ((v << n) | (v >> (64n - n))) & MASK;
const round = (acc: bigint, input: bigint) => mul(rotl(add(acc, mul(input, P2)), 31n), P1);
const mergeRound = (acc: bigint, value: bigint) => add(mul(acc ^ round(0n, value), P1), P4);

/** Reference XXH64, transcribed from the algorithm description. */
function referenceXxh64(input: Uint8Array, seed = 0n): bigint {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const len = input.byteLength;
  let offset = 0;
  let h: bigint;

  if (len >= 32) {
    let v1 = add(add(seed, P1), P2);
    let v2 = add(seed, P2);
    let v3 = seed;
    let v4 = (seed - P1) & MASK;
    const limit = len - 32;
    do {
      v1 = round(v1, view.getBigUint64(offset, true));
      v2 = round(v2, view.getBigUint64(offset + 8, true));
      v3 = round(v3, view.getBigUint64(offset + 16, true));
      v4 = round(v4, view.getBigUint64(offset + 24, true));
      offset += 32;
    } while (offset <= limit);
    h = add(add(rotl(v1, 1n), rotl(v2, 7n)), add(rotl(v3, 12n), rotl(v4, 18n)));
    h = mergeRound(h, v1);
    h = mergeRound(h, v2);
    h = mergeRound(h, v3);
    h = mergeRound(h, v4);
  } else {
    h = add(seed, P5);
  }

  h = add(h, BigInt(len));

  while (len - offset >= 8) {
    h = add(mul(rotl(h ^ round(0n, view.getBigUint64(offset, true)), 27n), P1), P4);
    offset += 8;
  }
  if (len - offset >= 4) {
    h = add(mul(rotl(h ^ mul(BigInt(view.getUint32(offset, true)), P1), 23n), P2), P3);
    offset += 4;
  }
  while (len - offset >= 1) {
    h = mul(rotl(h ^ mul(BigInt(view.getUint8(offset)), P5), 11n), P1);
    offset += 1;
  }

  h = mul(h ^ (h >> 33n), P2);
  h = mul(h ^ (h >> 29n), P3);
  return h ^ (h >> 32n);
}

/** Deterministic pseudo-random bytes (xorshift32) — no test-run flakiness. */
function pseudoRandomBytes(length: number, seed = 0x9e3779b9): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    out[i] = state & 0xff;
  }
  return out;
}

describe.runIf(isSupported())("xxhash64", () => {
  it("matches published XXH64 test vectors", () => {
    // The canonical empty-input vector from the xxHash reference implementation.
    expect(xxhash64(new Uint8Array(0))).toBe(0xef46db3751d8e999n);
    expect(xxhash64("")).toBe(0xef46db3751d8e999n);
  });

  it("honours the seed", () => {
    const seeded = xxhash64("", 1n);
    expect(seeded).not.toBe(xxhash64(""));
    expect(seeded).toBe(referenceXxh64(new Uint8Array(0), 1n));
    expect(xxhash64("seekite", 0xdeadbeefcafebaben)).toBe(
      referenceXxh64(new TextEncoder().encode("seekite"), 0xdeadbeefcafebaben),
    );
  });

  it("matches a from-spec reference across every tail-length branch", () => {
    // 0..40 covers the short path, the first striped 32-byte block, and every
    // 8/4/1-byte tail remainder; the larger sizes cover multi-block input.
    const lengths = [
      ...Array.from({ length: 41 }, (_, i) => i),
      63,
      64,
      65,
      127,
      128,
      1000,
      65_536,
    ];
    for (const length of lengths) {
      const bytes = pseudoRandomBytes(length);
      expect(xxhash64(bytes), `length ${length}`).toBe(referenceXxh64(bytes));
    }
  });

  it("hashes strings as UTF-8", () => {
    const text = "héllo 🔍 世界";
    expect(xxhash64(text)).toBe(xxhash64(new TextEncoder().encode(text)));
    expect(xxhash64(text)).toBe(referenceXxh64(new TextEncoder().encode(text)));
  });

  it("returns the full 64-bit value, not a lossy double", () => {
    // A value above 2^53 must survive exactly; this is why the API is BigInt.
    const hash = xxhash64(new Uint8Array(0));
    expect(hash > 2n ** 53n).toBe(true);
    expect(hash).toBe(BigInt.asUintN(64, hash));
  });

  it("respects the byte offset of a subarray view", () => {
    const backing = pseudoRandomBytes(64);
    const window = backing.subarray(8, 24);
    expect(xxhash64(window)).toBe(referenceXxh64(window));
  });
});
