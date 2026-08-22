# `@seekite/vitepress`

Wrap the VitePress config in `.vitepress/config.ts`:

```ts
import { defineConfig } from "vitepress"
import { withSeekite } from "@seekite/vitepress"

export default defineConfig(
  withSeekite({
    locales: { root: {}, fr: {} },
  }),
)
```

The wrapper keeps existing Vite plugins and `buildEnd` hooks, serves generated
artifacts in development, then indexes `.vitepress/dist` after VitePress has
rendered it. It prefers the default theme's `.vp-doc` content and creates a
route-filtered corpus per locale. An explicit `config` overrides those
generated corpus defaults. The lower-level `seekite()` Vite plugin remains
available for custom hook composition.

Add the shipped Vue search box to the default theme:

```ts
// .vitepress/theme/index.ts
import DefaultTheme from "vitepress/theme"
import { withSeekiteSearch } from "@seekite/vitepress/theme"
import "@seekite/vitepress/style.css"

export default withSeekiteSearch(DefaultTheme, {
  placeholder: "Search the docs…",
})
```

Leave VitePress's built-in `themeConfig.search` unset so only Seekite occupies
the navigation search area. `SeekiteSearchBox` is also exported directly for a
custom layout. It creates an SSR-safe `@seekite/search-ui` controller and uses
the generated `search` asset key; pass `client`, `controller`, `corpora`,
`facets`, or `queryOptions` to customize it. Locale builds can select their
route corpus explicitly, for example `corpora: ["fr"]`.

For fully custom renderers, `bindSeekiteSearchBox` remains available as the
low-level DOM/controller binding.

The supported peer range is VitePress 1 through 2; VitePress 1 is the
release-test baseline.
