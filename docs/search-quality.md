---
title: Search quality
section: Guides
order: 50
---

# Search quality

Seekite combines typo-tolerant lexical retrieval with optional semantic
ranking. Quality work is treated as an evidence problem: keep a representative
query set, record relevance judgments, and compare every ranking change to an
accepted baseline.

## Tier 1 behavior

The format-v2 runtime provides the features that most documentation and static
content search needs without loading every shard up front:

- Unicode-aware token folding and optional English stemming;
- prefix expansion for the final query token and bounded fuzzy matching, so a
  query such as `typo tolarance` still finds this page;
- BM25F field weights for title, heading, and body text;
- filters and facet counts over declared metadata columns;
- grouping by document, pagination, and lazily hydrated content snippets; and
- hybrid scoring when an embedding provider matching the index manifest is
  available, with a lexical-only fallback when it is not.

Fuzzy expansion is deliberately bounded. Short terms are not expanded into a
large neighborhood, candidates come from the lexical dictionary, and exact or
prefix matches remain more valuable than edit-distance matches.

## Configure the corpus

Declare searchable metadata at build time so the portable corpus contains only
the columns the UI needs:

```ts
import { defineSearch, staticVectors } from "seekite"
import { seekiteEmbeddings } from "@seekite/embeddings-ternlight"

export default defineSearch({
  corpora: {
    docs: {
      source: docs,
      vectors: staticVectors(seekiteEmbeddings()),
      lang: "en",
      filters: ["section", "version"],
      facets: ["section"],
      fields: { title: 2.4, heading: 1.5, body: 1 },
    },
  },
})
```

The query API controls ranking and result shape without changing the index:

```ts
const response = await search.query("typo tolarance", {
  corpora: ["docs"],
  mode: "hybrid",
  semanticWeight: 0.35,
  where: { section: "Guides" },
  facets: ["section"],
  group: "document",
  hydrate: true,
  limit: 10,
})
```

Use `mode: "lexical"` when deterministic text matching is the entire job, or
`mode: "semantic"` to inspect the vector ranker in isolation. Hybrid mode is
the normal product default, not a substitute for measuring both components.

## Measure a change

Put hand-reviewed relevance judgments in the query fixture configured under
`bench.queries`, then create a run file:

```sh
seekite bench --label before-ranking-change
seekite bench --baseline .seekite/bench/before-ranking-change.json
```

Review Recall@k, MRR, and NDCG for lexical and hybrid candidates together with
query latency and artifact size. Synthetic queries are useful retrievability
checks, but promote important cases to human judgments before treating their
scores as relevance evidence. Attach the baseline delta to every pull request
that changes analysis, chunking, embeddings, quantization, or ranking.

For a standards-based comparison across public research collections and peer
engines, use the separate [BEIR benchmark suite](./benchmarks.md). The two gates
answer different questions: this workflow protects relevance on your corpus;
BEIR makes cross-engine ranking claims reproducible.
