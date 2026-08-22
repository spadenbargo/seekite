---
title: VitePress
section: Integrations
order: 50
---

# VitePress

Add the VitePress-aware wrapper in `.vitepress/config.ts`:

```ts
import { defineConfig } from "vitepress"
import { seekite } from "@seekite/vitepress"

export default defineConfig({
  vite: {
    plugins: [seekite({ locales: { root: {}, fr: {} } })],
  },
})
```

The wrapper indexes `.vitepress/dist`, selects the default theme's `.vp-doc`
body, and excludes navigation, sidebars, SVG, and MathML noise. Passing locale
keys creates one route-filtered corpus per locale and records `locale` as a
facet. Set `config` to a config object or path when you need custom corpora.

`@seekite/vitepress/theme` exports `bindSeekiteSearchBox`. It connects an
`@seekite/search-ui` controller to an input element, including prefetch,
keyboard selection, Escape behavior, and navigation. Rendering remains in the
local Vue theme override, so the adapter does not impose a component style or a
second Vue abstraction.
