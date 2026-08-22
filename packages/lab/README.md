# `@seekite/lab`

Measure Seekite search quality against your own corpus. The package provides
binary-relevance metrics, deterministic synthetic eval generation, benchmark
runs, run comparisons, and the local `seekite lab` server.

Bench configuration lives beside your corpora in `search.config.ts`. Run it
through the main CLI with `seekite bench`, or import `bench` directly for CI.

Synthetic queries are intentionally labelled as retrievability checks. Promote
them to hand-reviewed judgments before treating the resulting scores as product
relevance metrics.
