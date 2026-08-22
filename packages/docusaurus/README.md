# `@seekite/docusaurus`

Register the plugin in `docusaurus.config.ts`:

```ts
export default {
  plugins: ["@seekite/docusaurus"],
}
```

The plugin indexes rendered HTML during Docusaurus's `postBuild` lifecycle and
writes `<outDir>/search`. It also registers a real `@theme/SearchBar` backed by
`@seekite/react`; no swizzle is required. The plugin injects a base-URL-aware
search asset meta tag, and the component discovers it lazily on first focus so
server rendering never reads browser globals.

Importing the component directly is useful for a custom navbar:

```tsx
import { SeekiteSearchBar } from "@seekite/docusaurus/theme"

export default function Search() {
  return <SeekiteSearchBar corpora={["docs"]} facets={["version", "locale"]} />
}
```

Default theme content is selected through `.theme-doc-markdown`; navigation
and sidebars are excluded.

`docusaurus_version` and `docusaurus_locale` meta tags are normalized to
`version` and `locale`, and both fields are emitted as filters and facets by
default. Override corpora, selectors, or vector settings in
`search.config.ts`. A Docusaurus site that renders routes only at request time
must provide explicit sources because postbuild indexing sees static HTML only.

The supported peer range is Docusaurus 3 through 4; Docusaurus 3 is the
release-test baseline.
