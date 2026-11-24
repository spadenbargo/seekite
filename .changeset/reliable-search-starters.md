---
"create-seekite": patch
"@seekite/core": minor
---

Include Vite client types so generated apps can build their CSS imports.

Queries now default to every corpus in the manifest, including after preloading.
To search only previously loaded corpora, pass `{ corpora: search.loaded() }`.
An explicit empty list searches none. Lexical queries skip static vector downloads,
and a later query can retry a failed manifest or vector load.
