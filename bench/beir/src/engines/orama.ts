import * as orama from "@orama/orama";
import { stemmer } from "@orama/stemmers/english";
import { stopwords } from "@orama/stopwords/english";
import type { EngineAdapter } from "../types.js";
import { uniqueRankedIds } from "./shared.js";

const schema = { title: "string", text: "string" } as const;

export const oramaAdapter: EngineAdapter = {
  name: "orama",
  label: "Orama 3.1.18",
  candidates: ["lexical"],
  async build(documents) {
    const database = orama.create({
      schema,
      components: {
        tokenizer: {
          language: "english",
          stemmer,
          stopWords: stopwords,
        },
      },
    });
    const inserted = await orama.insertMultiple(
      database,
      documents.map(({ id, title, text }) => ({ id, title, text })),
    );
    const corpusIdByEngineId = new Map(
      inserted.map((engineId, index) => [engineId, documents[index]!.id]),
    );
    return {
      async search(query, limit) {
        const result = await orama.search(database, {
          term: query,
          limit,
          properties: ["title", "text"],
          boost: { title: 2, text: 1 },
        });
        return uniqueRankedIds(
          result.hits.map((hit) => corpusIdByEngineId.get(hit.id)),
          limit,
        );
      },
    };
  },
};
