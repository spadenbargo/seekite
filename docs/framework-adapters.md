---
title: Framework adapters
section: Guides
order: 35
---

# Framework adapters

Use `@seekite/core` alone for imperative queries. For interactive search,
`@seekite/search-ui` adds one controller for query text, selection, loading,
filters and results. Each framework binding subscribes to that same controller.
You own the markup, navigation and styling.

Create the controller once per search view or sharing scope. On a server, use
a separate controller per request. The owner calls `controller.destroy()` when
finished. A binding releases only its own subscription when its view disappears.

```ts
import { createSearch } from "@seekite/core"
import { createSearchController } from "@seekite/search-ui"

const controller = createSearchController({
  client: createSearch(),
  queryOptions: { corpora: ["docs"], mode: "lexical" },
})
```

A worker proxy can also be the client. The worker entry imports the retrieval
engine and any embedding provider. The UI thread only needs the proxy and
its view binding. [Worker setup](./web-workers.md)

## Vanilla JavaScript

Subscribe directly and render the first snapshot on mount. The same pair of
subscribe and unsubscribe calls works in a custom element's connected and
disconnected callbacks.

```js
const input = document.querySelector("input")
const output = document.querySelector("output")
const render = () => { output.textContent = controller.getState().response?.total ?? 0 }
const change = () => controller.setQuery(input.value)
input.addEventListener("input", change)
const unsubscribe = controller.subscribe(render)
render()
// On teardown: unsubscribe() and input.removeEventListener("input", change).
```

## React

`@seekite/react/headless` exposes a hook for an external controller. This
entry only imports React. For the packaged dialog or search box, import
`SeekiteProvider` and the components from `@seekite/react`; styles are a
separate `@seekite/react/style.css` import.

```tsx
import { useSearchState } from "@seekite/react/headless"

function SearchCount({ controller }) {
  const state = useSearchState(controller)
  return <output>{state.response?.total ?? 0}</output>
}
```

## Vue

Call the composable during component setup. It returns a shallow ref and
starts listening on mount, so server rendering reads only the initial snapshot.

```vue
<script setup>
import { useSearchState } from "@seekite/vue"
const props = defineProps(["controller"])
const state = useSearchState(props.controller)
</script>
<template><output>{{ state.response?.total ?? 0 }}</output></template>
```

## Solid

Call the factory inside a component or reactive root. Read its accessor from
JSX. Disposing the owner releases the subscription.

```tsx
import { createSearchState } from "@seekite/solid"

function SearchCount(props) {
  const state = createSearchState(props.controller)
  return <output>{state().response?.total ?? 0}</output>
}
```

## Svelte

Use a readable store with Svelte's automatic subscription syntax. Its first
subscriber connects it to the controller and its last unsubscribe disconnects it.

```svelte
<script>
  import { searchStore } from "@seekite/svelte"
  let { controller } = $props()
  let results = $derived(searchStore(controller))
</script>
<output>{$results.response?.total ?? 0}</output>
```

## Angular

Create the signal in an injection context, such as a component field
initializer. The controller below is provided by the application. Angular's
`DestroyRef` releases the subscription with the component.

```ts
import { Component, InjectionToken, inject } from "@angular/core"
import type { SearchController } from "@seekite/search-ui"
import { injectSearchState } from "@seekite/angular"

export const SEARCH = new InjectionToken<SearchController>("Seekite search")

@Component({ selector: "search-count", standalone: true,
  template: "<output>{{ state().response?.total ?? 0 }}</output>" })
export class SearchCount {
  readonly state = injectSearchState(inject(SEARCH))
}
```
