---
title: Configuration
section: Guides
order: 30
---

# Configuration

`defineSearch` validates configuration through TypeScript while returning the
object unchanged.

```ts
import { defineSearch, staticVectors } from "seekite"

export default defineSearch({
  output: "dist/search",
  generatedDir: "dist",
  corpora: {
    docs: {
      include: ["/docs/**"],
      exclude: ["/docs/private/**"],
      chunk: { maxWords: 180, overlapWords: 30 },
      vectors: staticVectors(provider, { quantize: "i8" }),
      lang: "en",
      filters: ["version", "stars"],
      facets: ["tags"],
      fields: { title: 2, heading: 1.5, body: 1 },
    },
  },
})
```

Each corpus accepts:

- `include` and `exclude`: URL globs applied after a source loads documents.
- `source`: an async loader, adapter, Markdown/MDX glob, directory, or document
  array. If omitted, generated HTML is loaded.
- `vectors`: `staticVectors(provider)`, `runtimeVectors(provider)`, or `false`.
- `chunk`: maximum and overlapping word counts. Headings always start sections.
- `lang: "en"`: opt into the bundled light English stemmer. A custom stemmer
  may instead be declared as `analyzer: { id, stem }`; pass the same analyzer
  to the browser runtime.
- `filters` and `facets`: metadata fields retained in the scored payload.
- `fields`: corpus-default BM25F title, heading, and body weights.

Sources return `{ id, url, title, content, metadata? }`. The retrieval layer is
owned by the application; Seekite does not prescribe a CMS, database, or API:

```ts
import { defineSource } from "seekite"

const productDocs = defineSource("products-api", async ({ root }) => {
  const response = await fetch(process.env.PRODUCT_SEARCH_ENDPOINT!)
  const rows = await response.json()
  return rows.map((row) => ({
    id: String(row.id),
    url: `/products/${row.slug}`,
    title: row.name,
    content: row.description,
    metadata: { sourceRoot: root, category: row.category },
  }))
})
```

The loader runs only where the index is built (CI, the CLI, or the Vite plugin),
so credentials do not enter the browser bundle.

## Vector modes

`staticVectors(provider)` embeds all chunks during `seekite build` and writes
`vectors.bin`. This is the default recommendation for large or mostly stable
corpora: CI does the expensive work once, while browsers embed only each query.

`runtimeVectors(provider)` writes no corpus vector file. The browser lazily
embeds the loaded corpus on the first semantic or hybrid query and caches the
vectors for the life of the search client. It is useful for smaller corpora,
private per-user data, or deployments where CI should not execute the model.
Only the provider identity is needed at build time, so browser-only custom
providers may use `runtimeVectors({ id: "my-model:v1", dimensions: 384 })` and
pass the full implementation to `createSearch({ embeddings: provider })`.

The deprecated `embeddings: provider` form remains equivalent to
`vectors: staticVectors(provider)` for migration.

Static vectors default to row-wise int8 quantization. Use
`staticVectors(provider, { quantize: "f32" })` when exact f32 storage matters.
Both output modes reuse the same f32 embedding cache.

## Query options

Queries return `{ results, total, facets? }`. Prefix completion applies to the
unfinished final token; misspelled tokens use bounded edit distance. Results
group by source document by default.

```ts
const response = await search.query("auth plugn", {
  mode: "hybrid",
  semanticWeight: 0.35,
  fields: { title: 3 },
  where: { tags: { in: ["vite"] }, stars: { gte: 3 } },
  facets: ["tags"],
  group: "expanded",
  offset: 0,
  limit: 10,
})
```

Use `group: "none"` for chunk-level results, or `hydrate: false` when only
counts and scored metadata are needed. `total` is measured before pagination.
