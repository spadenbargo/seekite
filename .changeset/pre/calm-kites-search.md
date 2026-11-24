---
"@seekite/react": minor
"@seekite/search-ui": minor
---

Redesign the packaged search dialog around composable header, list, recent-search,
and footer primitives. The dialog now closes on the first Escape press while
preserving its query, uses an `ESC` close chip in place of `.seekite-close`, and
adds `SearchInput.openOnFocus` for modal-safe focus management.

BREAKING: the dialog's styling hooks and Escape behavior have changed. Replace
custom `.seekite-close` styles with `.seekite-esc`; dialog Escape now closes on
the first press without clearing the query. The inline `SearchBox` and
`controller.escape()` retain their existing clear-then-close contract.
