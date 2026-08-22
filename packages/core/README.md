# @seekite/core

Framework-independent browser runtime, index codecs, and public types for Seekite.
It intentionally has no runtime dependencies on Vite, UI frameworks, or embedding models.

```ts
import { createSearch } from "@seekite/core"

const search = createSearch({ key: "search", embeddings: provider })
await search.load("docs")
const { results, total, facets } = await search.query("authentication", {
  corpora: ["docs"],
  facets: ["tags"],
})
```

The relative key is resolved below Vite's build base. It defaults to `search`.
Use an explicit `url` instead when the index is hosted elsewhere.

Format v2 provides lazy postings/content shards, BM25F, prefix and typo
expansion, filters/facets, document grouping, pagination, highlighting, and
int8 vector scoring. The runtime continues to read format v1 during the 0.x
migration window.
