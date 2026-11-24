# @seekite/react

## 0.1.0-alpha.1

### Minor Changes

- 58116f1: Redesign the packaged search dialog around composable header, list, recent-search,
  and footer primitives. The dialog now closes on the first Escape press while
  preserving its query, uses an `ESC` close chip in place of `.seekite-close`, and
  adds `SearchInput.openOnFocus` for modal-safe focus management.
  
  BREAKING: the dialog's styling hooks and Escape behavior have changed. Replace
  custom `.seekite-close` styles with `.seekite-esc`; dialog Escape now closes on
  the first press without clearing the query. The inline `SearchBox` and
  `controller.escape()` retain their existing clear-then-close contract.
- 45bf09f: Bind a shared search controller to Angular signals, Solid accessors, Svelte stores,
  Vue refs, or React's external-store hook. Import the React hook from
  `@seekite/react/headless` for a component-free entry. VitePress uses the Vue
  binding. Unused React primitives and core codecs now tree-shake more effectively.

### Patch Changes

- Updated dependencies [58116f1]
  - @seekite/search-ui@0.1.0-alpha.1
