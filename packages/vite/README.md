# @seekite/vite

A thin Vite wrapper around `@seekite/build`. It indexes generated HTML after
Vite writes the application bundle.

```ts
import { defineConfig } from "vite"
import { seekite } from "@seekite/vite"

export default defineConfig({ plugins: [seekite()] })
```

For indexes generated separately in CI, write to `public/search` and use
`seekite({ indexing: "external" })`. Vite will validate and copy the prebuilt
assets instead of retrieving the corpus or generating vectors again.
