---
title: Astro
section: Integrations
order: 30
---

# Astro

Install `@seekite/astro` and add the integration to `astro.config.ts`:

```ts
import { defineConfig } from "astro/config"
import { seekite } from "@seekite/astro"

export default defineConfig({ integrations: [seekite()] })
```

Development indexing is provided by `@seekite/vite`. A production build is
indexed once in `astro:build:done`, after every page exists in `dist/`. Search
assets are written to `dist/search` by default.

The integration loads `search.config.ts` from the Astro project root when it
exists. Without one, it creates a lexical `docs` corpus from generated HTML.
Starlight's `.sl-markdown-content` is a default content root. For a custom
layout, mark the content container with `data-seekite-body` and mark page chrome
with `data-seekite-ignore`.

```ts
seekite({
  html: {
    bodySelector: ["#article", "main"],
    excludeSelectors: [".toc", ".edit-link"],
  },
})
```
