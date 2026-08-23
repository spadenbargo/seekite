import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSearch, staticVectors } from "@seekite/build";
import { createSearch, type EmbeddingProvider } from "@seekite/core";
import { seekiteEmbeddings } from "@seekite/embeddings-ternlight";
import type { EngineAdapter } from "../types.js";
import { uniqueRankedIds } from "./shared.js";

function fileFetch(): typeof fetch {
  return async (input) => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    try {
      const file = url.startsWith("file:") ? fileURLToPath(url) : url;
      const data = await readFile(file);
      return new Response(data, {
        headers: {
          "content-type": file.endsWith(".json") ? "application/json" : "application/octet-stream",
        },
      });
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code === "ENOENT") return new Response(null, { status: 404 });
      throw error;
    }
  };
}

export const seekiteAdapter: EngineAdapter = {
  name: "seekite",
  label: "Seekite",
  candidates: ["lexical", "hybrid"],
  async build(documents, context) {
    let embeddings: EmbeddingProvider | undefined;
    if (context.candidate === "hybrid") embeddings = seekiteEmbeddings();
    const output = path.resolve(context.temporaryDirectory, "index");
    await buildSearch(
      {
        format: 2,
        output,
        corpora: {
          beir: {
            source: documents.map((document) => ({
              id: document.id,
              url: `/beir/${context.dataset}/${encodeURIComponent(document.id)}`,
              title: document.title,
              content: document.text,
            })),
            lang: "en",
            vectors: embeddings ? staticVectors(embeddings) : false,
          },
        },
      },
      {
        root: context.temporaryDirectory,
        outputDir: output,
        cacheDir: path.join(context.cacheDirectory, "seekite-embeddings"),
      },
    );

    const client = createSearch({
      url: pathToFileURL(output).toString().replace(/\/$/, ""),
      fetch: fileFetch(),
      embeddings,
    });
    await client.load("beir");
    return {
      async search(query, limit) {
        const response = await client.query(query, {
          corpora: ["beir"],
          mode: context.candidate,
          semanticWeight: 0.35,
          group: "document",
          hydrate: false,
          limit,
          // Exact analyzed tokens are the BEIR/Lucene-style evaluation mode.
          // A zero expansion budget disables final-token prefix and fuzzy
          // expansions while retaining exact terms.
          maxExpansions: 0,
        });
        return uniqueRankedIds(
          response.results.map((result) => result.document.id),
          limit,
        );
      },
    };
  },
};
