# `@seekite/next`

Next has no stable post-export plugin hook, so Seekite runs as a postbuild:

```json
{
  "scripts": {
    "build": "next build",
    "postbuild": "seekite-next build"
  }
}
```

For `output: "export"`, the command indexes `out/` and writes `out/search/`.
Fully dynamic SSR routes cannot be indexed; provide explicit sources in
`search.config.ts` for content that is not rendered during the build.

The semi-internal `.next/server/app` HTML layout is available as a best-effort
fallback with `seekite-next build --next-server`; it writes to
`public/search/`. Prefer static export whenever possible.

Add immutable caching for shards and revalidation for the manifest:

```ts
import { withSeekiteHeaders } from "@seekite/next"

export default withSeekiteHeaders({ output: "export" })
```

The supported peer range is Next 14 through 16; Next 16 is the release-test
baseline.
