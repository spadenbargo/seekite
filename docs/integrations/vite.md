---
title: Vite integration
section: Integrations
order: 20
---

# Vite integration

There are two indexing strategies.

## Let Vite generate the index

```ts
export default defineConfig({ plugins: [seekite()] })
```

After a production build, the plugin indexes generated HTML and configured
sources into `<outDir>/search`. During development it rebuilds into
`<publicDir>/search` and serves those assets without caching. Use this for
runtime vectors or when the Vite build has access to the corpus.

## Generate in CI and publish through Vite

```ts
// search.config.ts
export default defineSearch({
  output: "public/search",
  corpora: { /* developer-owned sources */ },
})

// vite.config.ts
export default defineConfig({
  plugins: [seekite({ indexing: "external" })],
})
```

Run these commands in order:

```sh
seekite build
vite build
```

External mode does not retrieve or index the corpus inside Vite. It verifies
`public/search/manifest.json`, then Vite's normal public-directory handling
copies and links the whole search asset tree into the bundle. This keeps API
credentials and expensive static embedding work in the CI indexing step.

Persist `.seekite/cache` between CI builds so unchanged chunks do not run
through the embedding provider again. For GitHub Actions:

```yaml
- uses: actions/cache@v4
  with:
    path: .seekite/cache
    key: seekite-embeddings-${{ runner.os }}
    restore-keys: seekite-embeddings-
- run: pnpm exec seekite build --output public/search
```

The key intentionally stays stable; Seekite's internal content hashes handle
invalidation. See [Incremental embedding builds](../incremental-builds.md) for
pruning and Netlify/Cloudflare cache-mount guidance.

Set `assetsDir` on the plugin when using a name other than `search`, and use the
same name in `output`. Initialize the client with `createSearch({ key: "search" })`;
Seekite resolves the key below Vite's configured base path without exposing
`import.meta.env.BASE_URL` to application code. The key defaults to `search`.

The first-party embedding package ships bundler-ready Wasm and needs no Ternlight
dependency or `optimizeDeps.exclude` workaround.

Framework wrappers can configure rendered-HTML extraction through the same
plugin. Selector order is significant: the first selector with a match is used.

```ts
seekite({
  html: {
    bodySelector: ["[data-seekite-body]", "main", "article"],
    excludeSelectors: ["nav", "aside", ".table-of-contents"],
  },
})
```
