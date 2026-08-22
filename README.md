# Seekite — seek + Vite

Seekite is a framework-agnostic toolkit for building local-first search indexes
over arbitrary corpora. It builds lexical and semantic indexes, publishes
portable assets, and searches entirely in the browser. Corpus
vectors can be generated once in CI or lazily in the browser.

No server, database, API key, or external search service.

> [!WARNING]
> **Alpha software (`0.1.0-alpha.0`).** Seekite is under active development.
> Its public APIs, configuration, generated index format, and package boundaries
> are subject to change without backward-compatibility guarantees before 1.0.
> Evaluate it carefully before using it in production.

## Why Seekite?

- CI-generated static vectors or lazy runtime vectors
- Browser-side lexical, semantic, and hybrid search
- Independently loadable corpora
- Pluggable sources and embedding providers
- Portable, documented static assets
- Framework-independent runtime
- MIT licensed

## Quick start

Install the pieces used by your application:

```sh
pnpm add @seekite/core@alpha @seekite/vite@alpha @seekite/embeddings-ternlight@alpha
pnpm add -D seekite@alpha
```

Create `search.config.ts`:

```ts
import { seekiteEmbeddings } from "@seekite/embeddings-ternlight"
import { defineSearch, defineSource, staticVectors } from "seekite"

const cms = defineSource("cms", async () => {
  const response = await fetch("https://cms.example.com/search-documents")
  return response.json()
})

export default defineSearch({
  output: "public/search",
  corpora: {
    docs: {
      source: cms,
      vectors: staticVectors(seekiteEmbeddings()),
    },
    blog: {
      source: "./content/blog/**/*.md",
      vectors: false,
    },
  },
})
```

Add the Vite plugin:

```ts
import { defineConfig } from "vite"
import { seekite } from "@seekite/vite"

export default defineConfig({
  // `seekite build` runs in CI; Vite copies public/search into dist/search.
  plugins: [seekite({ indexing: "external" })],
})
```

Then query from any browser application. Pass the same provider to enable
query embeddings; without one, hybrid mode gracefully performs lexical search.

```ts
import { createSearch } from "@seekite/core"
import { seekiteEmbeddings } from "@seekite/embeddings-ternlight"

const embeddings = seekiteEmbeddings()
const search = createSearch({
  key: "search",
  embeddings,
})

await search.load("docs")
const results = await search.query("authentication", { corpora: ["docs"] })
```

See [Getting started](docs/getting-started.md), the [index format](docs/index-format.md),
and the runnable [examples](examples).

## Repository

| Package | Responsibility |
| --- | --- |
| `@seekite/core` | Dependency-free runtime, portable types, codecs, ranking |
| `@seekite/build` | Sources, extraction, chunking, indexing, serialization |
| `seekite` | Configuration API and `build` / `dev` CLI |
| `@seekite/vite` | Thin Vite build integration |
| `@seekite/embeddings-ternlight` | First-party Rust/Wasm local embeddings |

```sh
corepack pnpm install
pnpm check
pnpm --filter @seekite/example-vite-vanilla build
```

## License

[MIT](LICENSE). The embedding engine is maintained in this repository and was
derived from MIT-licensed Ternlight; its original notice is preserved with the
package.
