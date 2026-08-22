import { afterEach, describe, expect, it } from "vite-plus/test";
import { seekiteEmbeddings } from "./index.node.js";

const originalDisableNative = process.env["SEEKITE_DISABLE_NATIVE"];

afterEach(() => {
  if (originalDisableNative === undefined) delete process.env["SEEKITE_DISABLE_NATIVE"];
  else process.env["SEEKITE_DISABLE_NATIVE"] = originalDisableNative;
});

describe("Node embedding provider", () => {
  it("continues embedding through Wasm when native loading is disabled", async () => {
    process.env["SEEKITE_DISABLE_NATIVE"] = "1";
    const provider = seekiteEmbeddings();

    const [vector] = await provider.embedDocuments(["portable fallback"]);
    if (!vector) throw new Error("embedding provider returned no vector");
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

    expect(vector).toHaveLength(384);
    expect(norm).toBeCloseTo(1, 5);
  });
});
