import { seekiteEmbeddings } from "@seekite/embeddings-ternlight";
import { defineSearch, staticVectors } from "seekite";

const embeddings = seekiteEmbeddings();

export default defineSearch({
  corpora: {
    docs: {
      source: "./docs/**/*.md",
      vectors: staticVectors(embeddings),
      filters: ["section"],
      facets: ["section"],
      lang: "en",
    },
  },
  bench: {
    corpus: "docs",
    queries: "./bench/queries.jsonl",
    k: 10,
    candidates: {
      "mini-static": {},
      "mini-w25": { query: { semanticWeight: 0.25 } },
      "lexical-only": { vectors: false },
    },
  },
});
