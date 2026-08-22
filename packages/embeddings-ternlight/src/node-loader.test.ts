import type { NativeEngine } from "@seekite/engine-native";
import { describe, expect, it } from "vite-plus/test";
import { loadNodeEngine, type NativeEngineModule } from "./node-loader.js";
import type { EmbeddingEngine } from "./shared.js";

function fakeEngine(value: number): EmbeddingEngine {
  return { embed: () => new Float32Array([value]) };
}

describe("Node embedding backend selection", () => {
  it("uses the native engine when the optional peer has a matching prebuild", async () => {
    let wasmLoads = 0;
    const nativeEngine: NativeEngine = {
      dimensions: 1,
      embed: () => new Float32Array([1]),
      embedBatch: async (values) => values.map(() => new Float32Array([1])),
      configSummary: () => "fake",
    };
    const engine = await loadNodeEngine({
      model: "base",
      loadNative: async () => ({
        isSupported: () => true,
        createNativeEngine: (options) => {
          expect(options).toEqual({ model: "base" });
          return nativeEngine;
        },
      }),
      loadWasm: () => {
        wasmLoads += 1;
        return fakeEngine(2);
      },
    });

    expect(engine).toBe(nativeEngine);
    expect(wasmLoads).toBe(0);
  });

  const fallbackCases: Array<[string, () => Promise<NativeEngineModule>]> = [
    [
      "the optional package is absent",
      async () => {
        throw new Error("not installed");
      },
    ],
    [
      "the platform is unsupported",
      async () => ({
        isSupported: () => false,
        createNativeEngine: () => {
          throw new Error("must not construct");
        },
      }),
    ],
    [
      "native model construction fails",
      async () => ({
        isSupported: () => true,
        createNativeEngine: () => {
          throw new Error("bad native model");
        },
      }),
    ],
  ];

  it.each(fallbackCases)("falls back to Wasm when %s", async (_case, loadNative) => {
    const wasm = fakeEngine(3);
    const engine = await loadNodeEngine({
      model: "mini",
      loadNative,
      loadWasm: () => wasm,
    });

    expect(engine).toBe(wasm);
    expect(engine.embed("query")[0]).toBe(3);
  });
});
