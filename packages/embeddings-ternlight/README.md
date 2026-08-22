# @seekite/embeddings-ternlight

Seekite's first-party local embedding package. Its Rust inference engine,
generated Wasm, and Node/browser loaders are maintained in this repository and
run without a server or API key.

```ts
import { seekiteEmbeddings } from "@seekite/embeddings-ternlight"

const embeddings = seekiteEmbeddings()
```

The default entry includes only the compact model. Import
`seekiteBaseEmbeddings` from `@seekite/embeddings-ternlight/base` to use the
larger quality model without making every application bundle both Wasm files.

In Node, the provider automatically uses `@seekite/engine-native` when that
optional peer is installed and has a prebuilt binary for the current platform.
Unsupported platforms and missing or disabled native bindings fall back to the
committed Wasm engine without compiling anything during installation. Set
`SEEKITE_DISABLE_NATIVE=1` to force that portable path while troubleshooting.
Browsers always use Wasm.

Corpus embedding uses the native addon's off-thread batch API when available;
the provider ID and output vectors remain identical across native and Wasm.

The engine was derived from Ternlight v0.1.1 under MIT. Source provenance,
upstream license, and rebuild instructions are included under `native/`; this
package does not depend on either Ternlight npm package.

The packed models are Ternlight students distilled from the Apache-2.0
`sentence-transformers/all-MiniLM-L6-v2` teacher. Ternlight publishes the
weights under MIT. The base tier's recorded training mix contains roughly one
million English pairs from MS MARCO, Quora duplicates, AllNLI, GooAQ, and
StackExchange duplicates. Exact upstream commit and artifact hashes live in
`wasm/manifest.json`; see the provider guide for the per-tier provenance and
limitations.
