import { createRequire } from "node:module";
import { loadNodeEngine, requireEmbeddingEngine } from "./node-loader.js";
import { createSeekiteEmbeddings, type EmbeddingEngine } from "./shared.js";

const require = createRequire(import.meta.url);

async function loadEngine(): Promise<EmbeddingEngine> {
  return loadNodeEngine({
    model: "mini",
    loadNative: () => import("@seekite/engine-native"),
    loadWasm: () => requireEmbeddingEngine(require("../wasm/mini/node/tern_engine.js")),
  });
}

export function seekiteEmbeddings() {
  return createSeekiteEmbeddings(loadEngine, "mini");
}

/** @deprecated Use `seekiteEmbeddings`. */
export const ternlight = seekiteEmbeddings;
