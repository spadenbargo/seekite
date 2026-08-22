---
title: "Postbuild: any framework or host"
section: Integrations
order: 10
---

# Postbuild: any framework or host

Seekite only needs rendered HTML and a directory that your host publishes. For
frameworks without an adapter, run the ordinary CLI after the site build:

```json
{
  "scripts": {
    "build": "your-framework build",
    "postbuild": "seekite build --output dist/search"
  }
}
```

Point `generatedDir` at the framework output in `search.config.ts`. You can
narrow noisy layouts without writing a custom parser:

```ts
import { defineSearch, generatedHTML } from "@seekite/build"

export default defineSearch({
  generatedDir: "dist",
  output: "dist/search",
  corpora: {
    docs: {
      source: generatedHTML({
        bodySelector: ["[data-seekite-body]", "main", "article"],
        excludeSelectors: ["nav", "aside", ".table-of-contents"],
      }),
    },
  },
})
```

## Build caches

Persist `.seekite/cache` between deploys. Seekite keys every row by provider ID
and exact embedding input, so the outer CI cache key should stay stable.

For GitHub Pages:

```yaml
- uses: actions/cache@v4
  with:
    path: .seekite/cache
    key: seekite-embeddings-${{ runner.os }}
    restore-keys: seekite-embeddings-
- run: pnpm build
- run: pnpm exec seekite build --output dist/search
```

On Netlify or Cloudflare Pages, point `SEEKITE_CACHE_DIR` at the provider's
persistent build-cache directory, then use the same build and postbuild
commands. Run `seekite cache prune --max-size 500MB` before indexing when the
host imposes a cache quota.

Serve content-addressed corpus shards with
`Cache-Control: public, max-age=31536000, immutable`. Serve `manifest.json`
with `Cache-Control: public, max-age=0, must-revalidate` so a deploy switches to
the new shard set immediately.
