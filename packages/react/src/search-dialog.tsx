import {
  useEffect,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import {
  SearchViewProvider,
  useScopedSearchView,
  useSearchView,
  useSeekite,
  type ResultSelectHandler,
  type SeekiteResult,
} from "./context.js";
import {
  SearchEmpty,
  SearchFacets,
  SearchInput,
  SearchLoadMore,
  SearchResult,
  SearchResults,
  SearchSnippet,
  type SearchInputProps,
  type SearchResultProps,
  type SearchResultsProps,
} from "./primitives.js";

function classes(...values: Array<string | undefined | false>): string | undefined {
  const value = values.filter(Boolean).join(" ");
  return value || undefined;
}

const focusableSelector = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"]):not(.seekite-dialog-list)',
].join(",");

function SearchIcon({ loading }: { loading: boolean }) {
  return (
    <svg
      className={classes("seekite-search-icon", loading && "is-loading")}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  );
}

export interface SearchDialogHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  children?: ReactNode;
  label?: string;
  placeholder?: string;
  titleId?: string;
  inputRef?: Ref<HTMLInputElement>;
  inputProps?: Omit<SearchInputProps, "openOnFocus">;
}

/** The dialog title, search icon/input, and single-action ESC close button. */
export function SearchDialogHeader({
  children,
  label = "Search",
  placeholder = "Search…",
  titleId,
  inputRef,
  inputProps,
  className,
  ...props
}: SearchDialogHeaderProps) {
  const [state, controller] = useSeekite();

  return (
    <div {...props} className={classes("seekite-dialog-header", className)}>
      <h2 id={titleId} className="seekite-sr-only">
        {label}
      </h2>
      {children ?? (
        <>
          <SearchIcon loading={state.status === "loading"} />
          <SearchInput
            {...inputProps}
            ref={inputRef}
            className={classes("seekite-dialog-input", inputProps?.className)}
            aria-label={inputProps?.["aria-label"] ?? label}
            placeholder={inputProps?.placeholder ?? placeholder}
            openOnFocus={false}
            onKeyDown={(event) => {
              inputProps?.onKeyDown?.(event);
              if (event.defaultPrevented || event.nativeEvent.isComposing || event.key !== "Escape")
                return;
              event.preventDefault();
              controller.close();
            }}
          />
          <button
            type="button"
            className="seekite-esc"
            aria-label="Close search"
            onClick={() => controller.close()}
          >
            ESC
          </button>
        </>
      )}
    </div>
  );
}

type SearchDialogResultKind = "page" | "heading" | "text";

function resultKind(result: SeekiteResult): SearchDialogResultKind {
  if (result.heading) return "heading";
  if (result.content.trim() !== "") return "text";
  return "page";
}

export type SearchDialogResultProps = SearchResultProps;

/** A document-oriented result row with breadcrumbs and heading/text hierarchy cues. */
export function SearchDialogResult({
  result,
  className,
  children,
  ...props
}: SearchDialogResultProps) {
  const chunks =
    result.document.chunks && result.document.chunks.length > 0 ? result.document.chunks : [result];

  return (
    <SearchResult
      {...props}
      result={result}
      className={classes("seekite-dialog-result", className)}
      tabIndex={props.tabIndex ?? -1}
    >
      {children ?? (
        <>
          <span className="seekite-result-row seekite-result-page" data-kind="page">
            <span className="seekite-result-title">{result.title}</span>
          </span>
          {chunks.map((chunk, chunkIndex) => {
            const kind = resultKind(chunk);
            return (
              <span
                key={`${chunk.corpus}-${chunk.id}-${chunkIndex}`}
                className="seekite-result-row seekite-result-chunk"
                data-kind={kind === "page" ? "text" : kind}
              >
                <span className="seekite-result-crumbs">
                  <span>{result.title}</span>
                  {chunk.heading ? (
                    <>
                      <span className="seekite-result-chevron" aria-hidden="true">
                        ›
                      </span>
                      <span>{chunk.heading}</span>
                    </>
                  ) : null}
                </span>
                <span className="seekite-result-main">
                  {kind === "heading" ? (
                    <span className="seekite-result-hash" aria-hidden="true">
                      #
                    </span>
                  ) : null}
                  <SearchSnippet result={chunk} />
                </span>
              </span>
            );
          })}
        </>
      )}
    </SearchResult>
  );
}

export interface SearchDialogRecentProps extends HTMLAttributes<HTMLElement> {
  label?: string;
}

/** Recent-query shortcuts shown while the dialog input is empty. */
export function SearchDialogRecent({
  label = "Recent",
  className,
  ...props
}: SearchDialogRecentProps) {
  const [state, controller] = useSeekite();
  const view = useSearchView();
  if (state.query.trim() !== "" || state.recent.length === 0) return null;

  return (
    <section {...props} className={classes("seekite-recent", className)}>
      <h3 className="seekite-recent-label">{label}</h3>
      <ul className="seekite-recent-list">
        {state.recent.map((query) => (
          <li key={query}>
            <button
              type="button"
              className="seekite-recent-query"
              tabIndex={-1}
              onClick={(event) => {
                controller.setQuery(query);
                event.currentTarget.ownerDocument.getElementById(view.inputId)?.focus();
              }}
            >
              {query}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface SearchDialogListProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  children?: ReactNode;
  emptyMessage?: ReactNode;
  recentLabel?: string;
  renderResult?: SearchResultsProps["renderResult"];
}

/** Scrollable dialog body with guarded height observation and selected-row scrolling. */
export function SearchDialogList({
  children,
  emptyMessage = "No results found.",
  recentLabel = "Recent",
  renderResult,
  className,
  ...props
}: SearchDialogListProps) {
  const [state] = useSeekite();
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isEmpty = state.query.trim() === "" && state.recent.length === 0;

  useEffect(() => {
    const list = listRef.current;
    const content = contentRef.current;
    if (!list || !content) return undefined;

    const ResizeObserverConstructor =
      content.ownerDocument.defaultView?.ResizeObserver ?? globalThis.ResizeObserver;
    if (typeof ResizeObserverConstructor === "undefined") return undefined;

    const setHeight = (height: number): void => {
      list.style.setProperty("--seekite-list-height", `${Math.max(0, Math.ceil(height))}px`);
    };
    const observer = new ResizeObserverConstructor((entries) => {
      const entry = entries[0];
      const borderBox = entry?.borderBoxSize?.[0];
      setHeight(borderBox?.blockSize ?? entry?.contentRect.height ?? 0);
    });
    observer.observe(content);
    const initialHeight = content.getBoundingClientRect().height;
    if (initialHeight > 0) setHeight(initialHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (state.selectedIndex < 0) return;
    const selected = listRef.current?.querySelector<HTMLElement>(
      '[role="option"][aria-selected="true"]',
    );
    selected?.scrollIntoView?.({ block: "nearest" });
  }, [state.response, state.selectedIndex]);

  const defaultChildren = (
    <>
      <SearchDialogRecent label={recentLabel} />
      {state.status === "error" ? (
        <p className="seekite-error" role="alert">
          {state.error?.message ?? "Search failed."}
        </p>
      ) : null}
      <SearchEmpty>{emptyMessage}</SearchEmpty>
      <SearchResults
        groupByCorpus={false}
        renderResult={
          renderResult ?? ((result, index) => <SearchDialogResult result={result} index={index} />)
        }
      />
      <SearchLoadMore tabIndex={-1} />
    </>
  );

  return (
    <div
      {...props}
      ref={listRef}
      role={props.role ?? "region"}
      aria-label={props["aria-label"] ?? "Search results"}
      tabIndex={props.tabIndex ?? 0}
      className={classes("seekite-dialog-list", className)}
      data-empty={isEmpty ? "" : undefined}
    >
      <div ref={contentRef} className="seekite-dialog-list-content">
        {children ?? defaultChildren}
      </div>
    </div>
  );
}

export interface SearchDialogFooterProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  children?: ReactNode;
  showFacets?: boolean;
}

/** Subdued footer containing non-tabbable search filter chips by default. */
export function SearchDialogFooter({
  children,
  showFacets = true,
  className,
  ...props
}: SearchDialogFooterProps) {
  return (
    <div {...props} className={classes("seekite-dialog-footer", className)}>
      {children ?? (showFacets ? <SearchFacets facetTabIndex={-1} /> : null)}
    </div>
  );
}

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
  const titleId = `${view.inputId}-title`;

  useEffect(() => {
    if (!keyboardShortcut) return undefined;
    const ownerWindow =
      portalContainer?.ownerDocument.defaultView ??
      (typeof window === "undefined" ? undefined : window);
    if (!ownerWindow) return undefined;
    const toggleFromShortcut = (event: globalThis.KeyboardEvent): void => {
      if (
        event.isComposing ||
        event.key.toLocaleLowerCase() !== "k" ||
        (!event.metaKey && !event.ctrlKey)
      )
        return;
      event.preventDefault();
      if (controller.getState().open) controller.close();
      else controller.open();
    };
    ownerWindow.addEventListener("keydown", toggleFromShortcut);
    return () => {
      ownerWindow.removeEventListener("keydown", toggleFromShortcut);
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
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      controller.close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      controller.moveSelection(event.key === "ArrowDown" ? 1 : -1);
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
    if (!focusable.some((element) => element === active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && active === first) {
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
          if (event.button !== 0) return;
          if (closeOnBackdrop && event.target === event.currentTarget) controller.close();
        }}
      >
        <div
          {...props}
          ref={dialogRef}
          className={classes("seekite-root", "seekite-dialog", className)}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          data-status={state.status}
          onKeyDown={trapFocus}
        >
          <SearchDialogHeader
            label={label}
            placeholder={placeholder}
            titleId={titleId}
            inputRef={inputRef}
          />
          <SearchDialogList />
          <SearchDialogFooter showFacets={showFacets} />
        </div>
      </div>
    </SearchViewProvider>
  );
  return createPortal(dialog, target);
}
