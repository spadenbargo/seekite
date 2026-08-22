---
title: Embedding providers
section: Guides
order: 40
---

# Embedding providers

Providers are deliberately small:

```ts
interface EmbeddingProvider {
  id: string
  dimensions: number
  embedDocuments(documents: string[]): Promise<Float32Array[]>
  embedQuery(query: string): Promise<Float32Array>
}
```

The stable `id` is stored in the manifest. At runtime, providers are supplied by
ID so core never imports a model package.

The provider ID is also part of every incremental-build cache key. Treat it as
a versioned output contract: if the model, preprocessing, normalization, or any
other behavior that can change a vector changes, bump the ID (for example from
`:v1` to `:v2`). Reusing an ID for different output can serve stale vectors.

Providers should return deterministic f32 vectors in input order and should
batch efficiently in `embedDocuments`. Seekite sends all unique cache misses in
one call. A nondeterministic provider remains usable, but a cached build will
naturally retain the first vector generated for each exact text.

## Ternlight

```ts
import { seekiteEmbeddings } from "@seekite/embeddings-ternlight"

const provider = seekiteEmbeddings() // compact default

// Opt into the larger quality tier without bundling both models:
import { seekiteBaseEmbeddings } from "@seekite/embeddings-ternlight/base"
const qualityProvider = seekiteBaseEmbeddings()
```

Seekite supplies local 384-dimensional embeddings through a compact
Rust-to-WebAssembly engine. The engine source, Node/browser loaders, and
generated Wasm live in `packages/embeddings-ternlight`; there is no runtime or
build dependency on the `@ternlight/mini` or `@ternlight/base` npm packages.

The engine was derived from the MIT-licensed Ternlight v0.1.1 engine. Seekite
pins the source provenance, preserves the upstream notice, and provides a
rebuild script in the package's `native/` directory.

### Model and weight provenance

The committed artifacts are byte-for-byte the public Ternlight `mini` and
`base` int4 models. Ternlight publishes the models under MIT and distilled
them from `sentence-transformers/all-MiniLM-L6-v2`, whose model card declares
Apache-2.0. The base model records training run `robust-d384-mixv3-ep40`, data
manifest `mix_v3_1M` (seed 42), and roughly one million English pairs drawn
from MS MARCO, Quora duplicates, AllNLI, GooAQ, and StackExchange duplicates.
The mini artifact records run `qat-resume-ep10-ep40`; upstream's public model
card does not attach a data-manifest name to that older sidecar, so Seekite
does not claim one.

`wasm/manifest.json` pins Ternlight v0.1.1 commit
`c6d2c0a35d14c574ed2898b3dbf95977bca07208` and SHA-256 digests for both
generated Wasm files. The packed weights recovered from those files are also
verified against their self-hashes: mini `07d8cfdb…f2e5b6c98` (4,839,512
bytes), base `68cc2c43…d2ee1db8` (7,492,312 bytes). Rebuilding requires the
same packed model inputs; CI never silently substitutes a newly downloaded
model.

Both tiers are English-only, truncate at 128 WordPiece tokens, and inherit the
teacher model's data and bias limitations. They are intended for short search
queries and passages, not multilingual or long-document understanding.

Static mode uses the provider in CI for corpus vectors and in the browser for
queries. Runtime mode uses it in the browser for both. If a semantic corpus is
loaded without its provider, hybrid mode falls back to lexical scores.

See [Incremental embedding builds](incremental-builds.md) for cache layout,
management commands, and CI persistence recipes.
