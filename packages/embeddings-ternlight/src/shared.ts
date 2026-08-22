import type { EmbeddingProvider } from "@seekite/core";

export interface EmbeddingEngine {
  embed(value: string): Float32Array;
  /** Optional native fast path. Implementations must preserve input order. */
  embedBatch?(values: string[]): Promise<Float32Array[]>;
}

export type EngineLoader = () => Promise<EmbeddingEngine>;

const DIMENSIONS = 384;

export function createSeekiteEmbeddings(
  load: EngineLoader,
  model: "mini" | "base",
): EmbeddingProvider {
  let engine: Promise<EmbeddingEngine> | undefined;
  const getEngine = () => (engine ??= load());

  return {
    id: `seekite:ternlight:${model}:v1`,
    dimensions: DIMENSIONS,
    async embedDocuments(documents) {
      const loaded = await getEngine();
      if (loaded.embedBatch) return loaded.embedBatch(documents);
      return documents.map((document) => loaded.embed(document));
    },
    async embedQuery(query) {
      return (await getEngine()).embed(query);
    },
  };
}
