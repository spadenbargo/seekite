# @seekite/core

## 0.1.0-alpha.1

### Minor Changes

- 581de4d: Include Vite client types so generated apps can build their CSS imports.
  
  Queries now default to every corpus in the manifest, including after preloading.
  To search only previously loaded corpora, pass `{ corpora: search.loaded() }`.
  An explicit empty list searches none. Lexical queries skip static vector downloads,
  and a later query can retry a failed manifest or vector load.
- 581de4d: Pass the type of a search config to createSearch to check corpus names,
  filter and facet keys and infer result metadata. Worker clients support the
  same opt-in contract. defineSource preserves its loader's return type.

### Patch Changes

- 45bf09f: Bind a shared search controller to Angular signals, Solid accessors, Svelte stores,
  Vue refs, or React's external-store hook. Import the React hook from
  `@seekite/react/headless` for a component-free entry. VitePress uses the Vue
  binding. Unused React primitives and core codecs now tree-shake more effectively.
