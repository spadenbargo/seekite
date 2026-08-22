---
title: Next.js
section: Integrations
order: 40
---

# Next.js

Next has no stable after-export plugin hook. Run the small adapter command as a
package lifecycle instead:

```json
{
  "scripts": {
    "build": "next build",
    "postbuild": "seekite-next build"
  }
}
```

With `output: "export"`, `seekite-next` indexes `out/` and writes deployable
assets to `out/search`. It automatically loads a root `search.config.ts` when
present.

The `.next/server/app` prerender tree is a Next internal and therefore opt-in:

```sh
seekite-next build --next-server
```

That mode writes to `public/search`. Fully dynamic routes remain out of scope;
Seekite can index rendered/exported HTML or an explicit source, not live SSR
responses.

For a server deployment, wrap the Next config so immutable shards get a long
cache while the manifest is always revalidated:

```ts
import { withSeekiteHeaders } from "@seekite/next"

export default withSeekiteHeaders({ output: "export" })
```
