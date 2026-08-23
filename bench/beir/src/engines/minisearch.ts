import MiniSearch from "minisearch";
import type { BeirDocument, EngineAdapter } from "../types.js";
import { uniqueRankedIds } from "./shared.js";

export const minisearchAdapter: EngineAdapter = {
  name: "minisearch",
  label: "MiniSearch 7.2.0",
  candidates: ["lexical"],
  async build(documents) {
    const index = new MiniSearch<BeirDocument>({
      fields: ["title", "text"],
      idField: "id",
    });
    index.addAll(documents);
    return {
      async search(query, limit) {
        return uniqueRankedIds(
          index
            .search(query, { boost: { title: 2, text: 1 }, combineWith: "OR" })
            .slice(0, limit)
            .map((hit) => String(hit.id)),
          limit,
        );
      },
    };
  },
};
