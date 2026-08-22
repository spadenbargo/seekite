---
title: Getting started
section: Guides
order: 10
---

# Getting started

Seekite builds portable search metadata and a lexical index, then either ships
precomputed corpus vectors or creates them on demand in the browser.

## Install

```sh
pnpm add @seekite/core @seekite/vite @seekite/embeddings-ternlight
pnpm add -D seekite
```

## Static vectors in CI

Use an application-owned loader and write the index below Vite's public
directory:

```ts
// search.config.ts
import { seekiteEmbeddings } from "@seekite/embeddings-ternlight"
import { defineSearch, defineSource, staticVectors } from "seekite"

const docs = defineSource("docs-api", async () => {
  const response = await fetch(process.env.DOCS_SEARCH_URL!)
  return response.json()
})

export default defineSearch({
  output: "public/search",
  corpora: {
    docs: { source: docs, vectors: staticVectors(seekiteEmbeddings()) },
  },
})
```

Run `seekite build` before `vite build` in CI. Configure Vite with
`seekite({ indexing: "external" })`; it validates the manifest and lets Vite
copy `public/search` into the final public bundle.

## Runtime vectors

For a small corpus, replace the vector declaration:

```ts
import { runtimeVectors } from "seekite"

docs: { source: docs, vectors: runtimeVectors(seekiteEmbeddings()) }
```

Use regular `seekite()` Vite integration. No `vectors.bin` is emitted; the
browser creates and caches document vectors only after its first semantic or
hybrid query.

## Search

```ts
import { createSearch } from "@seekite/core"
import { seekiteEmbeddings } from "@seekite/embeddings-ternlight"

const search = createSearch({
  key: "search",
  embeddings: seekiteEmbeddings(),
})

const response = await search.query("canvas drawing", {
  corpora: ["docs"],
  mode: "hybrid",
  limit: 8,
})

for (const result of response.results) {
  console.log(result.title, result.score)
}
```

The client is plain TypeScript/JavaScript and does not require a UI framework.
`key: "search"` resolves to `<Vite BASE_URL>/search` internally; because
`search` is also the default key, it may be omitted. Use
`url: "https://cdn.example.com/index"` when assets are hosted separately.
Explicit URLs must be absolute or root-relative; relative locations are keys.

For search-as-you-type UIs, move the same client into a worker with
[`workerSearch`](web-workers.md), or install `@seekite/react` for an accessible
dialog and inline search box.
