# @seekite/bench-beir

Private workspace package for standardized search-quality evaluation on the
official BEIR SciFact, NFCorpus, and ArguAna test collections. This is separate
from `seekite bench`: the BEIR suite compares engines on public research
collections, while `seekite bench` protects relevance on this project's own
documentation corpus.

## Run

From the repository root:

```sh
pnpm --filter @seekite/bench-beir run bench -- \
  --datasets scifact,nfcorpus,arguana \
  --engines seekite,zbsearch,orama,minisearch \
  --candidates lexical \
  --check
```

The first run downloads roughly 9 MB of checksum-pinned archives from official
BEIR hosting into the gitignored repository directory `.cache/beir/`. The
default report paths are:

```text
bench/beir/results/<YYYY-MM-DD>-<host>.json
bench/beir/results/<YYYY-MM-DD>-<host>.md
```

Use an explicit JSON path for deterministic automation; the Markdown path is
derived by replacing `.json` with `.md`:

```sh
pnpm --filter @seekite/bench-beir run bench -- \
  --engines seekite,zbsearch,orama \
  --candidates lexical \
  --check \
  --out "$GITHUB_WORKSPACE/bench/beir/results/ci.json"
```

`BEIR_CACHE_DIR` or `--cache` can move the cache. `--budget-ms` overrides the
default five-minute query-loop budget per engine and dataset.

## Candidates and checks

`lexical` is supported by every adapter. `hybrid` is intentionally supported
only by Seekite and runs the local Ternlight embedding provider; it is suitable
for designated maintainer hardware, not the deterministic CI quality gate.

`--check` requires the Seekite lexical candidate. It fails when:

- Seekite nDCG@10 is below the published Lucene BM25 multifield reference by
  more than 0.15 on any selected dataset; or
- a reviewed measurement in `accepted.json` regresses by more than 0.02.

The committed baseline contains reviewed Seekite lexical nDCG@10 measurements
from all three collections. A schema-valid empty baseline is also handled
honestly: the sanity check still runs and reports say that regression comparison
was not evaluated. Do not populate the file from a partial or timed-out run.

## Data and result hygiene

The archives and extracted corpora are never committed. Downloads are accepted
only when both byte length and SHA-256 match the pinned definition in
`src/datasets.ts`; extraction happens in a temporary directory and the loader
validates ids, qrels, and expected collection counts.

Official qrels are preserved verbatim even if a judged document id is absent
from the corresponding corpus (ArguAna contains a small number of these). Such
an unreachable judgment correctly remains in metric denominators.

Reports contain aggregate numbers, counts, package/environment versions, and
archive hashes only. They do not contain query text, document text, rankings,
or other corpus content.
