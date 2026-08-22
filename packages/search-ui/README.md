# `@seekite/search-ui`

Framework-independent search state and interaction logic for Seekite. It
turns a core `SearchClient` into an immutable subscribe/snapshot store suitable
for `useSyncExternalStore`, Vue, Svelte, vanilla DOM code, or a custom renderer.

## Install

```sh
pnpm add @seekite/core @seekite/search-ui
```

## Create a controller

```ts
import { createSearch } from "@seekite/core"
import { createSearchController } from "@seekite/search-ui"

const controller = createSearchController({
  client: createSearch({ key: "search" }),
  queryOptions: {
    corpora: ["docs"],
    mode: "hybrid",
    facets: ["tags"],
    limit: 10,
  },
  recentStorageKey: "seekite:recent",
})

const unsubscribe = controller.subscribe(() => {
  render(controller.getState())
})

controller.open()
controller.setQuery("worker runt")
```

Snapshots are referentially stable between updates and frozen at runtime.
Queries debounce for 80 ms by default. A request must remain unresolved for
150 ms before `status` changes to `"loading"`, avoiding spinner flicker for
fast local searches. Older responses and errors are discarded when a newer
query, filter change, or page request starts.

## Intents

- `prefetch()` and `open()` call `client.warmup?.()` and load every configured
  corpus. Repeated calls share one successful prefetch.
- `toggleFacet(field, value)` maintains a filter predicate such as
  `{ tags: { in: ["vite", "astro"] } }` without discarding range or `exists`
  predicates on that field.
- `loadMore()` appends the next offset page and stops when the loaded result
  count reaches `response.total`.
- `moveSelection(1 | -1)` wraps at both ends; `selectResult()` returns the
  selected result and records the trimmed query in the recent-search list.
- `snippetFor(result)` memoizes core's highlighting-aware `snippet()` result by
  result identity.

The keyboard Escape contract is exposed as `controller.escape()`. When the
query is non-empty, the first call clears it and returns `"cleared"` while the
controller stays open. Calling it again closes the controller and returns
`"closed"`. Active facet filters deliberately survive this input-clearing
step; clear them explicitly with `setFilters({})` when the product UI calls for
that behavior.

Call `destroy()` when the owning UI is removed. It cancels debounce/loading
timers, drops active responses, clears subscribers, and makes later intents
no-ops.

## Storage and SSR

Recent-search persistence is opt-in. Without `recentStorageKey`, recents live
only for the controller's lifetime and `localStorage` is never touched. When a
key is configured, unavailable or blocked storage is treated as a cache miss,
so constructing a controller during SSR remains safe. Non-browser hosts can
provide the small `storage` interface directly.
