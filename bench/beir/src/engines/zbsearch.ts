import { stemmer } from "@zbsearch/stemmers/english";
import { stopwords } from "@zbsearch/stopwords/english";
import * as zbsearch from "zbsearch";
import type { EngineAdapter } from "../types.js";
import { uniqueRankedIds } from "./shared.js";

const schema = { title: "string", text: "string" } as const;

export const zbsearchAdapter: EngineAdapter = {
  name: "zbsearch",
  label: "ZBSearch 4.0.0 (BM25)",
  candidates: ["lexical"],
  async build(documents) {
    const database = zbsearch.create({
      schema,
      components: {
        tokenizer: {
          language: "english",
          stemmer,
          stopWords: stopwords,
          // ZBSearch needs duplicate tokens to retain true term frequency.
          allowDuplicates: true,
        },
      },
    });
    const inserted = await zbsearch.insertMultiple(
      database,
      documents.map(({ id, title, text }) => ({ id, title, text })),
    );
    const corpusIdByEngineId = new Map(
      inserted.map((engineId, index) => [engineId, documents[index]!.id]),
    );
    return {
      async search(query, limit) {
        const result = await zbsearch.search(database, {
          term: query,
          limit,
          properties: ["title", "text"],
          boost: { title: 2, text: 1 },
          // Prefix matching is a search-as-you-type feature. Disabling it is
          // ZBSearch's documented full-query/Lucene-style benchmark mode.
          prefix: false,
        });
        return uniqueRankedIds(
          result.hits.map((hit) => corpusIdByEngineId.get(hit.id)),
          limit,
        );
      },
    };
  },
};
