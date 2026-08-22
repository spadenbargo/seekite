---
title: Architecture
section: Guides
order: 20
---

# Architecture

```text
Developer source → extraction → heading-aware chunks → sharded BM25F index
                                          ├─ static vectors (CI) ─┐
                                          └─ runtime vectors ─────┤
                                      portable assets → browser ranking
```

The boundaries are deliberate:

- `core` knows the portable format and browser ranking, but not build tools.
- `build` owns the complete indexing pipeline.
- `vite` waits for generated HTML and invokes `build`; it has no indexing logic.
- the first-party Rust/Wasm embedding engine can run in Node and the browser.
- every corpus has its own metadata, postings, and either static, runtime, or no
  vectors.

This means a non-Seekite producer can emit the documented assets and use the
runtime, while another runtime can consume assets produced by Seekite.

Format v2 eagerly loads a compact columnar corpus and front-coded dictionary,
then fetches only the postings and content shards needed by a query. Static
vectors default to per-row int8 quantization. Query analysis folds diacritics,
optionally stems, expands prefixes and typos, then applies filters, document
grouping, pagination, hydration, and highlight metadata.

Hybrid ranking normalizes per-corpus BM25F scores and combines them with cosine
similarity. `semanticWeight` controls the blend and defaults to `0.5`. The same
runtime can live in a Web Worker through `workerSearch`, keeping inference and
scoring off the main thread.
