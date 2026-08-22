import { createSeekiteEmbeddings, type EmbeddingEngine } from "./shared.js";

async function loadEngine(): Promise<EmbeddingEngine> {
  return import("../wasm/mini/bundler/tern_engine.js");
}

export function seekiteEmbeddings() {
  return createSeekiteEmbeddings(loadEngine, "mini");
}

/** @deprecated Use `seekiteEmbeddings`. */
export const ternlight = seekiteEmbeddings;
