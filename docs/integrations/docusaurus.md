---
title: Docusaurus
section: Integrations
order: 60
---

# Docusaurus

Register Seekite as a Docusaurus plugin:

```ts
export default {
  plugins: ["@seekite/docusaurus"],
}
```

The plugin runs after Docusaurus's `postBuild` lifecycle, indexes the completed
HTML tree, and writes `<outDir>/search`. The default theme's
`.theme-doc-markdown` element is preferred as the content root.

Docusaurus `docusaurus_version` and `docusaurus_locale` meta tags are normalized
to `version` and `locale`. Both become filter and facet columns automatically,
which supports a version or language selector without duplicating indexing
logic in the adapter.

An existing `search.config.ts` controls custom corpora, vector modes, and route
inclusions. Routes that only render dynamically are not visible at postbuild
time and need an explicit source.
