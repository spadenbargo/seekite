---
title: Incremental embedding builds
section: Guides
order: 70
---

# Incremental embedding builds

Static embedding builds use a local content-addressed cache by default. Seekite
hashes the provider ID and the exact text sent to the provider, then reuses the
stored `Float32Array` whenever that pair appears again. Changing one page only
re-embeds chunks whose embedding text changed.

The default location is `.seekite/cache` under the project root. Keep
`.seekite/` in `.gitignore`: it contains rebuildable local state, not published
search assets. Set `SEEKITE_CACHE_DIR` to an absolute path or a path relative to
the project root when a CI system mounts its build cache elsewhere.

Build output makes reuse visible:

```text
Seekite wrote public/search (docs: 512 chunks, 480 cached, 32 embedded (2.1s))
```

`seekite build --no-cache` and `SEEKITE_NO_CACHE=1` bypass reads for a cold
measurement. Fresh vectors are still appended, so the run warms the cache for
the next build. Runtime-vector and lexical-only corpora do not use the cache.

## Cache maintenance

```sh
pnpm exec seekite cache stats
pnpm exec seekite cache prune
pnpm exec seekite cache prune --max-size 500MB
pnpm exec seekite cache clear
pnpm exec seekite cache clear --provider seekite:ternlight:mini:v1
```

`prune` compacts append-only files and removes rows no longer referenced by an
index. `--max-size` then evicts the least-recently-used entries until vector
data fits the requested budget. All commands honor `SEEKITE_CACHE_DIR`.

## GitHub Actions

The cache action key deliberately does not include a content hash. Seekite's
per-chunk hashes provide invalidation; the action cache is only a byte store.

```yaml
- uses: actions/cache@v4
  with:
    path: .seekite/cache
    key: seekite-embeddings-${{ runner.os }}
    restore-keys: seekite-embeddings-
- run: pnpm exec seekite cache prune --max-size 500MB
- run: pnpm exec seekite build --output public/search
```

GitHub evicts caches at repository scope. For a large corpus, keep the prune
step so a restored cache remains within a deliberate budget. On Netlify, use a
persistent cache directory and point `SEEKITE_CACHE_DIR` at it. On Cloudflare
Pages, use the equivalent build-cache mount; the directory may be shared across
deploys because provider ID and content hashing perform all invalidation.

Cache rows are always little-endian f32, independently of the published vector
dtype. A single warm cache can therefore serve both f32 and quantized output.
