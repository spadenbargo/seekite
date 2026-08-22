# seekite

The Seekite CLI and configuration entry point.

```sh
pnpm exec seekite build
pnpm exec seekite dev
pnpm exec seekite cache stats
pnpm exec seekite cache prune --max-size 500MB
pnpm exec seekite cache clear
pnpm exec seekite bench
pnpm exec seekite lab
```

Static builds reuse `.seekite/cache` automatically. `build --no-cache` bypasses
reads but still warms the cache. Set `SEEKITE_CACHE_DIR` for a persistent CI
mount, or `SEEKITE_NO_CACHE=1` for a cold run.

`seekite bench --baseline <run.json>` turns NDCG regressions into a failing
exit code. `seekite bench --compare <run-a> <run-b>` prints saved-run deltas,
and `seekite lab` opens the local candidate matrix and per-query inspector.
These commands load the optional `@seekite/lab` package only when invoked.
