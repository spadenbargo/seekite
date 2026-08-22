import { useEffect, useRef, type HTMLAttributes, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  SearchViewProvider,
  useScopedSearchView,
  useSeekite,
  type ResultSelectHandler,
} from "./context.js";
import {
  SearchEmpty,
  SearchFacets,
  SearchInput,
  SearchLoadMore,
  SearchResults,
} from "./primitives.js";

function classes(...values: Array<string | undefined | false>): string | undefined {
  const value = values.filter(Boolean).join(" ");
  return value || undefined;
}

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export interface SearchDialogProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  label?: string;
  placeholder?: string;
  onResultSelect?: ResultSelectHandler;
  showFacets?: boolean;
  closeOnBackdrop?: boolean;
  keyboardShortcut?: boolean;
  portalContainer?: Element;
}

export function SearchDialog({
  label = "Search",
  placeholder = "Search…",
  onResultSelect,
  showFacets = true,
  closeOnBackdrop = true,
  keyboardShortcut = true,
  portalContainer,
  className,
  onKeyDown,
  ...props
}: SearchDialogProps) {
  const [state, controller] = useSeekite();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const select: ResultSelectHandler = (result) => {
    onResultSelect?.(result);
    controller.close();
  };
  const view = useScopedSearchView(select);

  useEffect(() => {
    if (!keyboardShortcut) return undefined;
    const ownerWindow =
      portalContainer?.ownerDocument.defaultView ??
      (typeof window === "undefined" ? undefined : window);
    if (!ownerWindow) return undefined;
    const openFromShortcut = (event: globalThis.KeyboardEvent): void => {
      if (event.key.toLocaleLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey)) return;
      event.preventDefault();
      controller.open();
    };
    ownerWindow.addEventListener("keydown", openFromShortcut);
    return () => {
      ownerWindow.removeEventListener("keydown", openFromShortcut);
    };
  }, [controller, keyboardShortcut, portalContainer]);

  useEffect(() => {
    if (!state.open) return undefined;
    const dialog = dialogRef.current;
    const ownerDocument = dialog?.ownerDocument;
    if (!dialog || !ownerDocument) return undefined;
    const previouslyFocused = ownerDocument.activeElement;
    const previousOverflow = ownerDocument.body.style.overflow;
    ownerDocument.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => {
      ownerDocument.body.style.overflow = previousOverflow;
      const ownerWindow = ownerDocument.defaultView;
      if (
        ownerWindow &&
        previouslyFocused instanceof ownerWindow.HTMLElement &&
        previouslyFocused.isConnected
      ) {
        previouslyFocused.focus();
      }
    };
  }, [state.open]);

  if (!state.open) return null;
  const ownerDocument =
    portalContainer?.ownerDocument ?? (typeof document === "undefined" ? undefined : document);
  if (!ownerDocument) return null;
  const target = portalContainer ?? ownerDocument.body;

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      controller.escape();
      inputRef.current?.focus();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
    );
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    const active = ownerDocument.activeElement;
    if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const dialog = (
    <SearchViewProvider value={view}>
      <div
        className="seekite-overlay"
        onPointerDown={(event) => {
          if (closeOnBackdrop && event.target === event.currentTarget) controller.close();
        }}
      >
        <div
          {...props}
          ref={dialogRef}
          className={classes("seekite-root", "seekite-dialog", className)}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${view.inputId}-title`}
          tabIndex={-1}
          data-status={state.status}
          onKeyDown={trapFocus}
        >
          <div className="seekite-dialog-header">
            <h2 id={`${view.inputId}-title`}>{label}</h2>
            <button
              type="button"
              className="seekite-close"
              aria-label="Close search"
              onClick={() => controller.close()}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <SearchInput ref={inputRef} aria-label={label} placeholder={placeholder} />
          {state.status === "error" ? (
            <p className="seekite-error" role="alert">
              {state.error?.message ?? "Search failed."}
            </p>
          ) : null}
          {showFacets ? <SearchFacets /> : null}
          <SearchEmpty />
          <SearchResults />
          <SearchLoadMore />
        </div>
      </div>
    </SearchViewProvider>
  );
  return createPortal(dialog, target);
}
