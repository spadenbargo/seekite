# @seekite/build

The shared Seekite build engine: sources, extraction, heading-aware chunking,
lexical indexing, embeddings, and portable static serialization.

```ts
import { buildSearch, defineSearch, defineSource, staticVectors } from "@seekite/build"

await buildSearch(defineSearch({
  corpora: {
    docs: {
      source: defineSource("api", async () => fetchDocuments()),
      vectors: staticVectors(provider),
    },
  },
}))
```

Static vectors are cached under `.seekite/cache` by provider ID and exact
embedding text. Pass `{ cache: false }` to bypass reads while still warming the
cache, or `{ cacheDir: "/mounted/cache" }` to override its location. The
`SEEKITE_CACHE_DIR` and `SEEKITE_NO_CACHE=1` environment variables provide the
same controls for CI.

The builder writes sharded format v2 with int8 vectors by default. Pass
`staticVectors(provider, { quantize: "f32" })` for f32 output, or
`buildSearch(config, { format: 1 })` for the temporary legacy escape hatch.

Framework adapters share `loadSearchConfig()` and `runIntegrationBuild()`.
The latter loads `search.config.ts` when present and otherwise indexes a default
`docs` corpus from rendered HTML. `generatedHTML()` accepts ordered
`bodySelector` values plus `excludeSelectors`; defaults prefer
`[data-seekite-body]`, `main`, and `article`, while excluding navigation,
sidebars, scripts, SVG, MathML, and `[data-seekite-ignore]` content.
