import { createSeekiteEmbeddings, type EmbeddingEngine } from "./shared.js";

async function loadEngine(): Promise<EmbeddingEngine> {
  return import("../wasm/base/bundler/tern_engine.js");
}

export function seekiteBaseEmbeddings() {
  return createSeekiteEmbeddings(loadEngine, "base");
}
