import { createRequire } from "node:module";
import { describe, expect, it } from "vite-plus/test";

import { PARITY_FIXTURES } from "./fixtures.js";
import { createNativeEngine, isSupported, type NativeModelName } from "./index.js";

/**
 * Native-vs-wasm parity.
 *
 * `@seekite/embeddings-ternlight` reports one provider id per model
 * (`seekite:ternlight:mini:v1`) regardless of which backend produced a vector.
 * An index built in CI with the native addon therefore has to be queryable in a
 * browser running wasm. That only holds if the two backends agree *exactly* —
 * a 1-ULP difference in one dimension silently reorders near-ties in cosine
 * ranking, and there is no way for a consumer to detect it. So the assertion
 * here is byte equality of the underlying buffers, not `toBeCloseTo`.
 *
 * Both backends compile the same crate over the same packed weights; the only
 * divergence risk is the `bitlinear_inner_simd` inner loop, which is `simd128`
 * on wasm and scalar on native. That loop is pure `i8 × i8 → i32` integer
 * multiply-accumulate with a proven bound of |acc| ≤ 128 × 1024, so it cannot
 * overflow and integer addition is associative — the SIMD lane reduction and
 * the scalar loop are required to produce the same integer. Everything else is
 * IEEE-754 `f32` in an identical evaluation order (Rust does not contract to
 * FMA), with `libm` supplying `expf`/`erff` in software on both targets.
 */

const require = createRequire(import.meta.url);

interface WasmEngine {
  embed(text: string): Float32Array;
  config_summary(): string;
}

function loadWasm(model: NativeModelName): WasmEngine {
  return require(`../../embeddings-ternlight/wasm/${model}/node/tern_engine.js`) as WasmEngine;
}

/** Raw bytes behind a `Float32Array`, so `-0` vs `0` and NaN payloads count. */
function bytesOf(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

function describeDelta(a: Float32Array, b: Float32Array): string {
  let worst = 0;
  let worstIndex = -1;
  let differing = 0;
  for (let i = 0; i < a.length; i++) {
    const delta = Math.abs((a[i] as number) - (b[i] as number));
    if (delta !== 0) differing++;
    if (delta > worst) {
      worst = delta;
      worstIndex = i;
    }
  }
  return `${differing}/${a.length} dims differ; worst |Δ| ${worst} at dim ${worstIndex} (native ${a[worstIndex]}, wasm ${b[worstIndex]})`;
}

// Every platform outside the prebuild matrix runs wasm only; there is nothing
// to compare there, and failing would be wrong.
describe.runIf(isSupported())("native/wasm parity", () => {
  for (const model of ["mini", "base"] as const) {
    describe(model, () => {
      // Keep engine creation inside tests: Vitest still collects the callback
      // for a skipped suite, including when SEEKITE_DISABLE_NATIVE is set.
      const native = () => createNativeEngine({ model });
      const wasm = () => loadWasm(model);

      it("loads the same weights", () => {
        expect(native().configSummary()).toBe(wasm().config_summary());
      });

      it(`produces bit-identical vectors for all ${PARITY_FIXTURES.length} fixtures`, () => {
        const mismatches: string[] = [];
        for (const text of PARITY_FIXTURES) {
          const fromNative = native().embed(text);
          const fromWasm = wasm().embed(text);
          expect(fromNative.length).toBe(fromWasm.length);
          if (!bytesOf(fromNative).equals(bytesOf(fromWasm))) {
            mismatches.push(
              `${JSON.stringify(text.slice(0, 48))}: ${describeDelta(fromNative, fromWasm)}`,
            );
          }
        }
        expect(
          mismatches,
          `native and wasm disagree — the shared provider id is no longer valid:\n${mismatches.join("\n")}`,
        ).toEqual([]);
      });

      it("returns L2-normalised vectors", () => {
        for (const text of ["hello world", "", "🔍 unicode"]) {
          const vector = native().embed(text);
          const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
          expect(norm).toBeCloseTo(1, 5);
        }
      });
    });
  }

  describe("batch determinism", () => {
    it("matches sequential embed() bit for bit, at any concurrency", async () => {
      const native = createNativeEngine({ model: "mini" });
      const texts = PARITY_FIXTURES.slice(0, 40);
      const sequential = texts.map((text) => bytesOf(native.embed(text)));

      // 1 thread and 8 threads must agree with each other and with sequential:
      // work is split across texts, never inside a single forward pass.
      for (const concurrency of [1, 8, undefined]) {
        const batch = await native.embedBatch(texts, concurrency);
        expect(batch).toHaveLength(texts.length);
        batch.forEach((vector, index) => {
          expect(
            bytesOf(vector).equals(sequential[index] as Buffer),
            `concurrency=${concurrency} diverged at index ${index}`,
          ).toBe(true);
        });
      }
    });

    it("keeps the event loop turning while a large batch runs", async () => {
      const native = createNativeEngine({ model: "mini" });
      // 600 chunks is ~0.5 s of native work — long enough that a synchronous
      // implementation would starve the timer completely.
      const texts = Array.from(
        { length: 600 },
        (_, i) => `chunk ${i}: ${PARITY_FIXTURES[i % PARITY_FIXTURES.length]}`,
      );
      let ticks = 0;
      const timer = setInterval(() => ticks++, 5);
      try {
        await native.embedBatch(texts);
      } finally {
        clearInterval(timer);
      }
      expect(ticks, "embedBatch blocked the JS thread").toBeGreaterThan(0);
    }, 15_000);
  });
});

describe("fallback", () => {
  it("reports unsupported and refuses to build an engine when the addon is disabled", async () => {
    const previous = process.env["SEEKITE_DISABLE_NATIVE"];
    process.env["SEEKITE_DISABLE_NATIVE"] = "1";
    try {
      expect(isSupported()).toBe(false);
      expect(() => createNativeEngine()).toThrow(/SEEKITE_DISABLE_NATIVE/);
    } finally {
      if (previous === undefined) delete process.env["SEEKITE_DISABLE_NATIVE"];
      else process.env["SEEKITE_DISABLE_NATIVE"] = previous;
    }
  });

  it("still embeds through wasm when native is unavailable", () => {
    // The wasm engine is the fallback target and carries no native dependency,
    // so it must work on its own on any platform.
    const wasm = loadWasm("mini");
    const vector = wasm.embed("static site search that works offline");
    expect(vector).toHaveLength(384);
    expect(Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))).toBeCloseTo(1, 5);
  });
});
