import { describe, expect, it } from "vite-plus/test";
import { createSeekiteEmbeddings, type EmbeddingEngine } from "./shared.js";

describe("embedding provider batching", () => {
  it("uses an engine batch fast path and preserves its result order", async () => {
    const calls: string[][] = [];
    const engine: EmbeddingEngine = {
      embed: () => {
        throw new Error("sequential embed should not run");
      },
      async embedBatch(values) {
        calls.push(values);
        return values.map((value) => new Float32Array([value.length]));
      },
    };
    const provider = createSeekiteEmbeddings(async () => engine, "mini");

    const vectors = await provider.embedDocuments(["first", "second value"]);

    expect(calls).toEqual([["first", "second value"]]);
    expect(vectors.map((vector) => vector[0])).toEqual([5, 12]);
  });

  it("retains the sequential Wasm-compatible path when batching is absent", async () => {
    const calls: string[] = [];
    const provider = createSeekiteEmbeddings(
      async () => ({
        embed(value) {
          calls.push(value);
          return new Float32Array([value.length]);
        },
      }),
      "base",
    );

    await provider.embedDocuments(["a", "bb"]);

    expect(calls).toEqual(["a", "bb"]);
  });
});
