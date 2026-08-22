import { createSearch, exposeSearch } from "@seekite/core";
import { seekiteEmbeddings } from "@seekite/embeddings-ternlight";

exposeSearch(createSearch({ key: "search", embeddings: seekiteEmbeddings() }));
