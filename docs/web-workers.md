---
title: Web Workers
section: Guides
order: 80
---

# Web Workers

Runtime embeddings and scoring can run off the main thread without changing
the search API. The application owns the worker entry, so its bundler can put
the selected embedding provider and Wasm module in the worker chunk.

## Browser setup

Create a worker entry beside the application code:

```ts
// search.worker.ts
import { createSearch, exposeSearch } from "@seekite/core"
import { seekiteEmbeddings } from "@seekite/embeddings-ternlight"

exposeSearch(createSearch({
  key: "search",
  embeddings: seekiteEmbeddings(),
}))
```

Create the proxy on the main thread:

```ts
// search.ts
import { workerSearch } from "@seekite/core"

export const search = workerSearch(
  () => new Worker(new URL("./search.worker.ts", import.meta.url), { type: "module" }),
)

const results = await search.query("canvas drawing")
```

Vite inlines `import.meta.env.BASE_URL` in worker bundles, so a relative asset
key resolves correctly even though workers do not have a `document`.

`workerSearch` does not create the worker until `load`, `query`, or `warmup`
is called. Calls made while an asynchronous worker factory is starting are
queued on that one worker. If it crashes, outstanding calls reject and the
next call creates a fresh worker.

Call `warmup()` on an intentional interaction such as focusing the search
box. It loads the search runtime and embedding engine before the first typed
query pays that cost:

```ts
searchInput.addEventListener("focus", () => {
  void search.warmup()
}, { once: true })
```

The proxy implements the same `load`, `query`, and synchronous `loaded`
methods as `createSearch`. Its `loaded()` value is the latest worker-side
snapshot received after an RPC completes.

## SSR and cleanup

Do not call the proxy during server rendering, where the browser `Worker`
global is unavailable. Defining it at module scope is safe because creation is
lazy; invoke it only from client-side code. Framework UI components should
construct or use it from a browser lifecycle hook.

Terminate a long-lived proxy when its application boundary is removed:

```ts
await search.destroy() // `terminate()` is an equivalent alias
```

Destroying rejects outstanding requests and permanently closes that proxy.

## Node worker threads

The same protocol accepts Node's raw `message` event shape. Pass `parentPort`
explicitly in the worker entry:

```ts
// search.worker.ts
import { parentPort } from "node:worker_threads"
import { createSearch, exposeSearch } from "@seekite/core"

if (!parentPort) throw new Error("search worker requires a parent port")
exposeSearch(createSearch({ url: "https://example.test/search" }), parentPort)
```

Then use a `node:worker_threads` worker as the factory result:

```ts
import { Worker } from "node:worker_threads"
import { workerSearch } from "@seekite/core"

const search = workerSearch(
  () => new Worker(new URL("./search.worker.js", import.meta.url)),
)
```

Only structured-clone-safe values cross the boundary. Worker exceptions are
sent as plain `{ name, message }` data and reconstructed as errors on the
calling side; provider objects and other functions stay inside the worker.
