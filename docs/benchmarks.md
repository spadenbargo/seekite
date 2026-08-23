---
title: Benchmarks
section: Guides
order: 55
---

# Benchmarks

Seekite uses standard BEIR collections to measure ranking quality independently
of its own documentation. The primary measure is nDCG@10; MAP@100, Recall@100,
P@10, and MRR@10 make failures easier to interpret. Build time and query latency
are recorded by the same run, but only quality is suitable for deterministic CI
gating.

## Seekite harness results

Seekite lexical was measured on 23 August 2026 with Node 24.18.0 under Linux
(WSL2) on an AMD Ryzen 7 7800X3D (16 logical cores). The Git revision was
`3c1a127`; the worktree contained the benchmark implementation. ZBSearch,
Orama, and MiniSearch were then measured on the same machine and configuration.
Hybrid remains pending. Empty cells are not estimates, and an unfavorable
result is not removed from the published table.

| Engine | SciFact nDCG@10 | NFCorpus nDCG@10 | ArguAna nDCG@10 | Macro nDCG@10 | Macro ms/query |
| --- | ---: | ---: | ---: | ---: | ---: |
| Seekite (lexical) | 0.684 | 0.317 | 0.371 | 0.457 | 132.75 |
| Seekite (hybrid, designated hardware) | Pending | Pending | Pending | Pending | Pending |
| ZBSearch 4.0.0 (BM25) | 0.587 | 0.293 | 0.372 | 0.418 | 13.07 |
| Orama 3.1.18 | 0.377 | 0.245 | 0.202 | 0.274 | 67.07 |
| MiniSearch 7.2.0 | 0.605 | 0.290 | 0.000† | 0.298† | 3.59† |

Accepted values live in
[`bench/beir/accepted.json`](https://github.com/spadenbargo/seekite/blob/main/bench/beir/accepted.json).
Machine-readable run files also record the UTC date, Git revision and dirty
state, CPU, operating system, Node/V8 versions, memory, and exact search-package
versions. Quality values are portable across machines; published latency values
must come from a named, otherwise-idle machine because shared CI runners are
noisy. The latency above is informational and query-count-weighted across the
three collections; per-dataset values were 10.02 ms (SciFact), 2.36 ms
(NFCorpus), and 188.90 ms (ArguAna). † MiniSearch exceeded the five-minute
ArguAna query budget after 951 of 1,406 queries, so that collection is scored
zero. Its displayed macro latency covers only its two completed collections;
the quality macro includes the zero.

## Published ZBSearch comparison

For context, [ZBSearch's published BEIR benchmark](https://www.zbsearch.dev/benchmarks)
reported the following macro averages on 11 August 2026. Its environment was
Node 24.16.0 on Apple Silicon, with ZBSearch 4.0.0 and Orama 3.1.18. These are
third-party results from a different machine and harness run, so they are a
cited comparison target—not a same-machine claim about Seekite.

| Engine | nDCG@10 (macro) | ms/query (macro) |
| --- | ---: | ---: |
| ZBSearch (BM25) | 0.453 | 8.8 |
| Lunr | 0.425 | 125 |
| MiniSearch | 0.305 | 3.47 |
| Orama | 0.222 | 27.8 |
| FlexSearch | 0.168 | 0.01 |
| ZBSearch (PT15) | 0.164 | 9.28 |
| ZBSearch (QPS) | 0.112 | 53.5 |
| Fuse.js | 0.066 | 213 |

Their per-collection ZBSearch BM25 nDCG@10 values were 0.675 on SciFact,
0.307 on NFCorpus, and 0.378 on ArguAna. The corresponding Lucene BM25
multifield references from the BEIR paper are 0.665, 0.325, and 0.414.

## Methodology

The harness downloads the official
[BEIR](https://github.com/beir-cellar/beir) SciFact, NFCorpus, and ArguAna
archives from TU Darmstadt. It pins both SHA-256 and archive byte length before
extracting into `.cache/beir/`; none of the licensed dataset content is stored
in Git or copied into result files.

The three collections contain 17,490 documents and 2,029 judged test queries in
total:

| Dataset | Documents | Test queries | Judgments |
| --- | ---: | ---: | --- |
| SciFact | 5,183 | 300 | Binary |
| NFCorpus | 3,633 | 323 | Graded 1–2 |
| ArguAna | 8,674 | 1,406 | Binary, one relevant document per query |

Every adapter indexes separate `title` and `text` fields and retrieves at most
100 unique document ids. Each query is evaluated, then the per-query scores are
averaged. Official qrels are not rewritten; an ArguAna judgment whose target id
is absent from the corpus remains an unretrieved relevant document. The metric
definitions match `trec_eval`/BEIR conventions:

- nDCG@10 uses linear graded gain, not `2^relevance - 1`;
- MAP@100 divides by all positive qrels, including relevant documents below the
  cutoff;
- Recall@100 uses positive qrels as relevant;
- P@10 always divides by 10, even for a shorter result list; and
- MRR@10 is the reciprocal rank of the first positive-qrel result.

A query loop has a five-minute budget for each engine and collection. Exceeding
it marks that row as budget-exceeded and scores every quality metric as zero.
The JSON and Markdown reports are written after every completed engine so a
later failure does not erase earlier work.

Seekite uses its public format-v2 build and query APIs, English stemming, normal
BM25F title/heading/body weights, document grouping, and `maxExpansions: 0` for
exact analyzed-token retrieval. This deliberately disables the final-token
prefix and bounded fuzzy expansion used by interactive documentation search.
Documents that still cross the normal chunk boundary are defensively deduped by
their BEIR document id. Hybrid uses Ternlight with a semantic weight of 0.35 and
the normal content-addressed embedding cache.

ZBSearch uses its official English stemmer and stopword packages with duplicate
tokens retained for term frequency, and disables search-as-you-type prefix
matching. Orama uses its official English analyzer packages and default query
behavior because its `exact` option is a verbatim all-term filter, not exact
analyzed-token retrieval. MiniSearch uses the tokenizer it ships. All peer
adapters apply the same 2:1 title-to-text boost.

## Reproduce

From a clean checkout with Node 20 or newer and pnpm installed:

```sh
pnpm install --frozen-lockfile
pnpm --filter @seekite/bench-beir run test
pnpm --filter @seekite/bench-beir run bench -- \
  --datasets scifact,nfcorpus,arguana \
  --engines seekite,zbsearch,orama,minisearch \
  --candidates lexical \
  --check
```

The default outputs are
`bench/beir/results/<YYYY-MM-DD>-<host>.{json,md}`. To add local hybrid data,
run `--engines seekite --candidates hybrid` without `--check`; embedding all
documents can take several minutes. Full options and CI-safe explicit output
paths are documented in `bench/beir/README.md`.

This standardized suite complements the [corpus-specific quality workflow](./search-quality.md).
The latter remains the right gate for the queries and relevance judgments that
represent your own product.
