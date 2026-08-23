import type { EngineAdapter, EngineName } from "../types.js";
import { minisearchAdapter } from "./minisearch.js";
import { oramaAdapter } from "./orama.js";
import { seekiteAdapter } from "./seekite.js";
import { zbsearchAdapter } from "./zbsearch.js";

export const ENGINE_ADAPTERS: Readonly<Record<EngineName, EngineAdapter>> = {
  seekite: seekiteAdapter,
  zbsearch: zbsearchAdapter,
  orama: oramaAdapter,
  minisearch: minisearchAdapter,
};
