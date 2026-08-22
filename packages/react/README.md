# `@seekite/react`

Accessible, drop-in React search UI for Seekite. It pairs the headless state
machine from `@seekite/search-ui` with an inline combobox, a portal dialog, and
composable primitives. React and React DOM stay peer dependencies, and styling
is a standalone zero-runtime CSS file.

## Install

```sh
pnpm add @seekite/core @seekite/search-ui @seekite/react
```

Import the default theme once in your application:

```ts
import "@seekite/react/style.css"
```

## Drop-in dialog

```tsx
import { createSearch } from "@seekite/core"
import { SearchDialog, SeekiteProvider, useSeekite } from "@seekite/react"

const client = createSearch({ url: "/search" })

function OpenSearch() {
  const [, search] = useSeekite()
  return <button onClick={() => search.open()}>Search docs</button>
}

export function App() {
  return (
    <SeekiteProvider
      client={client}
      options={{ queryOptions: { corpora: ["docs"], facets: ["tags"] } }}
    >
      <OpenSearch />
      <SearchDialog
        label="Search documentation"
        onResultSelect={(result) => location.assign(result.url)}
      />
    </SeekiteProvider>
  )
}
```

`SearchDialog` portals into `document.body` only while the controller is open.
It traps focus, locks body scrolling, restores the previously focused element,
and closes when its backdrop is pressed. ⌘K (macOS) or Ctrl+K opens it by
default; set `keyboardShortcut={false}` when the host application owns that
binding. Pass `portalContainer` to target a different element. The closed
server render does not read `window` or `document`.

For a header or sidebar, replace the trigger and dialog with:

```tsx
<SearchBox
  placeholder="Search guides…"
  onResultSelect={(result) => navigate(result.url)}
/>
```

## Compose your own UI

All prebuilt views are compositions of the same primitives:

```tsx
import { Search } from "@seekite/react"

function CustomSearch() {
  return (
    <section>
      <Search.Input aria-label="Search API reference" />
      <Search.Facets fields={["version"]} />
      <Search.Empty>No matching API pages.</Search.Empty>
      <Search.Results />
      <Search.LoadMore />
    </section>
  )
}
```

`Search.Results` provides corpus groups and default result rows. Supply
`renderResult={(result, index) => <Search.Result result={result} index={index}>…</Search.Result>}`
for custom rows, or pass explicit `Search.Result` children. `Search.Snippet`
renders core highlight ranges with semantic `<mark>` elements.

`useSeekite()` returns the immutable `[state, controller]` pair. This is also
the escape hatch for opening and closing views, showing recents, or binding a
product-specific keyboard shortcut.

## Keyboard and accessibility contract

- The input follows the WAI-ARIA combobox pattern and owns a grouped listbox.
- Up/Down wraps through results; Enter resolves and persists the selected
  result. Escape clears a non-empty query first, then closes on the next press.
- Result-count and loading changes are announced through a polite live region.
- Facet chips are labelled toggle buttons, and all built-in controls expose
  visible focus indicators.

## Theme

Override any `--seekite-*` variable, such as `--seekite-accent`,
`--seekite-radius`, `--seekite-font`, `--seekite-z-index`, or
`--seekite-dialog-width`. The stylesheet follows `prefers-color-scheme` and
supports explicit `data-theme="light"` / `data-theme="dark"` overrides.
