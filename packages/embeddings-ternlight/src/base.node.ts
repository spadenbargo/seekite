import { createRequire } from "node:module";
import { loadNodeEngine, requireEmbeddingEngine } from "./node-loader.js";
import { createSeekiteEmbeddings, type EmbeddingEngine } from "./shared.js";

const require = createRequire(import.meta.url);

async function loadEngine(): Promise<EmbeddingEngine> {
  return loadNodeEngine({
    model: "base",
    loadNative: () => import("@seekite/engine-native"),
    loadWasm: () => requireEmbeddingEngine(require("../wasm/base/node/tern_engine.js")),
  });
}

export function seekiteBaseEmbeddings() {
  return createSeekiteEmbeddings(loadEngine, "base");
}
