# `@seekite/astro`

Add Seekite to `astro.config.ts`:

```ts
import { defineConfig } from "astro/config"
import { seekite } from "@seekite/astro"

export default defineConfig({ integrations: [seekite()] })
```

The integration reuses `@seekite/vite` during development, then indexes the
rendered `dist/` tree during `astro:build:done`. An existing
`search.config.ts` is loaded automatically. Without one, a `docs` corpus is
created from generated HTML and written to `dist/search`.

Starlight's `.sl-markdown-content` is included in the default body selectors.
Use `data-seekite-body` to select a narrower content root and
`data-seekite-ignore` on page chrome that should never be indexed.

The supported peer range is Astro 4 through 6; Astro 6 is the release-test
baseline.
