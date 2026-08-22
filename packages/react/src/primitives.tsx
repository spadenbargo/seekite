import {
  Fragment,
  forwardRef,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type LiHTMLAttributes,
  type ReactNode,
} from "react";
import {
  useSearchView,
  useSeekite,
  type ResultSelectHandler,
  type SeekiteResult as SearchResultValue,
} from "./context.js";

type FacetScalar = string | number | boolean | null;
type FacetValue =
  | FacetScalar
  | FacetScalar[]
  | { in?: FacetScalar[]; gte?: number; gt?: number; lte?: number; lt?: number; exists?: boolean };

function classes(...values: Array<string | undefined | false>): string | undefined {
  const value = values.filter(Boolean).join(" ");
  return value || undefined;
}

function resultOptionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}

function isPredicate(
  value: FacetValue | undefined,
): value is Exclude<FacetValue, FacetScalar | FacetScalar[]> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function selectedFacetValues(value: FacetValue | undefined): FacetScalar[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (isPredicate(value)) return value.in ?? [];
  return [value];
}

export interface SearchInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "defaultValue" | "onChange" | "value"
> {
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  onResultSelect?: ResultSelectHandler;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    className,
    onChange,
    onFocus,
    onKeyDown,
    onResultSelect,
    "aria-label": ariaLabel = "Search",
    ...props
  },
  ref,
) {
  const [state, controller] = useSeekite();
  const view = useSearchView();
  const selected = state.response?.results[state.selectedIndex];

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      controller.moveSelection(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter") {
      const result = controller.selectResult();
      if (!result) return;
      event.preventDefault();
      (onResultSelect ?? view.onResultSelect)?.(result);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      controller.escape();
    }
  };

  return (
    <input
      {...props}
      ref={ref}
      id={props.id ?? view.inputId}
      className={classes("seekite-input", className)}
      role="combobox"
      aria-label={ariaLabel}
      aria-autocomplete="list"
      aria-haspopup="listbox"
      aria-expanded={state.open}
      aria-controls={state.open ? view.listboxId : undefined}
      aria-describedby={state.open ? view.liveId : undefined}
      aria-activedescendant={
        state.open && selected ? resultOptionId(view.listboxId, state.selectedIndex) : undefined
      }
      autoComplete={props.autoComplete ?? "off"}
      spellCheck={props.spellCheck ?? false}
      value={state.query}
      onChange={(event) => {
        onChange?.(event);
        if (!event.defaultPrevented) controller.setQuery(event.currentTarget.value);
      }}
      onFocus={(event) => {
        onFocus?.(event);
        if (!event.defaultPrevented) controller.open();
      }}
      onKeyDown={handleKeyDown}
    />
  );
});

function moveToResult(
  controller: ReturnType<typeof useSeekite>[1],
  currentIndex: number,
  count: number,
  targetIndex: number,
): void {
  if (count === 0 || targetIndex < 0 || targetIndex >= count || currentIndex === targetIndex)
    return;
  let cursor = currentIndex;
  if (cursor < 0) {
    controller.moveSelection(1);
    cursor = 0;
  }
  while (cursor !== targetIndex) {
    controller.moveSelection(1);
    cursor = (cursor + 1) % count;
  }
}

export interface SearchResultProps extends Omit<LiHTMLAttributes<HTMLLIElement>, "onSelect"> {
  result: SearchResultValue;
  index: number;
  onResultSelect?: ResultSelectHandler;
  children?: ReactNode;
}

export const SearchResult = forwardRef<HTMLLIElement, SearchResultProps>(function SearchResult(
  { result, index, onResultSelect, children, className, onClick, onPointerMove, ...props },
  ref,
) {
  const [state, controller] = useSeekite();
  const view = useSearchView();
  const selected = state.selectedIndex === index;
  const moveHere = (): void =>
    moveToResult(controller, state.selectedIndex, state.response?.results.length ?? 0, index);

  return (
    <li
      {...props}
      ref={ref}
      id={props.id ?? resultOptionId(view.listboxId, index)}
      className={classes("seekite-result", selected && "is-selected", className)}
      role="option"
      aria-selected={selected}
      data-result-id={result.id}
      onPointerMove={(event) => {
        onPointerMove?.(event);
        if (!event.defaultPrevented && event.pointerType !== "touch") moveHere();
      }}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        moveHere();
        const selectedResult = controller.selectResult() ?? result;
        (onResultSelect ?? view.onResultSelect)?.(selectedResult);
      }}
    >
      {children ?? (
        <>
          <span className="seekite-result-title">{result.title}</span>
          {result.heading ? <span className="seekite-result-heading">{result.heading}</span> : null}
          <SearchSnippet result={result} />
        </>
      )}
    </li>
  );
});

interface ResultGroup {
  corpus: string;
  start: number;
  results: Array<{ result: SearchResultValue; index: number }>;
}

function resultGroups(results: SearchResultValue[]): ResultGroup[] {
  const groups: ResultGroup[] = [];
  results.forEach((result, index) => {
    const previous = groups.at(-1);
    if (previous?.corpus === result.corpus) previous.results.push({ result, index });
    else groups.push({ corpus: result.corpus, start: index, results: [{ result, index }] });
  });
  return groups;
}

function statusMessage(
  status: ReturnType<typeof useSeekite>[0]["status"],
  query: string,
  total: number | undefined,
  error: Error | undefined,
): string {
  if (status === "loading") return "Loading results";
  if (status === "error") return `Search failed: ${error?.message ?? "Unknown error"}`;
  if (status === "ready") return `${total ?? 0} ${(total ?? 0) === 1 ? "result" : "results"}`;
  return query === "" ? "Type to search" : "Searching";
}

export interface SearchResultsProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  children?: ReactNode;
  renderResult?: (result: SearchResultValue, index: number) => ReactNode;
  onResultSelect?: ResultSelectHandler;
  label?: string;
}

export function SearchResults({
  children,
  renderResult,
  onResultSelect,
  label = "Search results",
  className,
  ...props
}: SearchResultsProps) {
  const [state] = useSeekite();
  const view = useSearchView();
  const results = state.response?.results ?? [];
  const groups = resultGroups(results);

  return (
    <div {...props} className={classes("seekite-results-region", className)}>
      <span
        id={view.liveId}
        className="seekite-sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {statusMessage(state.status, state.query, state.response?.total, state.error)}
      </span>
      <ul
        id={view.listboxId}
        className="seekite-results"
        role="listbox"
        aria-label={label}
        aria-busy={state.status === "loading"}
      >
        {children ??
          groups.map((group) => {
            const labelId = `${view.listboxId}-group-${group.start}`;
            return (
              <li key={`${group.corpus}-${group.start}`} role="presentation">
                <div role="group" aria-labelledby={labelId}>
                  <div id={labelId} className="seekite-group-label">
                    {group.corpus}
                  </div>
                  <ul role="presentation" className="seekite-group-results">
                    {group.results.map(({ result, index }) =>
                      renderResult ? (
                        <Fragment key={`${result.corpus}-${result.id}`}>
                          {renderResult(result, index)}
                        </Fragment>
                      ) : (
                        <SearchResult
                          key={`${result.corpus}-${result.id}`}
                          result={result}
                          index={index}
                          onResultSelect={onResultSelect}
                        />
                      ),
                    )}
                  </ul>
                </div>
              </li>
            );
          })}
      </ul>
    </div>
  );
}

export interface SearchSnippetProps extends HTMLAttributes<HTMLSpanElement> {
  result: SearchResultValue;
}

export function SearchSnippet({ result, className, ...props }: SearchSnippetProps) {
  const [, controller] = useSeekite();
  const value = controller.snippetFor(result);
  const content: ReactNode[] = [];
  let cursor = 0;
  value.ranges.forEach(([start, end], index) => {
    if (start > cursor) content.push(value.text.slice(cursor, start));
    content.push(
      <mark key={`${start}-${end}-${index}`} className="seekite-highlight">
        {value.text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  });
  if (cursor < value.text.length) content.push(value.text.slice(cursor));

  return (
    <span {...props} className={classes("seekite-snippet", className)}>
      {content}
    </span>
  );
}

export interface SearchFacetsProps extends HTMLAttributes<HTMLDivElement> {
  fields?: string[];
  labelForField?: (field: string) => ReactNode;
  labelForValue?: (field: string, value: string, count: number) => ReactNode;
}

export function SearchFacets({
  fields,
  labelForField = (field) => field,
  labelForValue = (_field, value, count) => `${value} (${count})`,
  className,
  ...props
}: SearchFacetsProps) {
  const [state, controller] = useSeekite();
  const facets = state.response?.facets;
  if (!facets) return null;
  const visibleFields = fields ?? Object.keys(facets);

  return (
    <div {...props} className={classes("seekite-facets", className)}>
      {visibleFields.map((field) => {
        const counts = facets[field];
        if (!counts) return null;
        const active = selectedFacetValues(state.activeFilters[field]);
        return (
          <fieldset key={field} className="seekite-facet-group">
            <legend>{labelForField(field)}</legend>
            <div className="seekite-facet-values">
              {Object.entries(counts).map(([value, count]) => {
                const selected = active.some((entry) => String(entry) === value);
                return (
                  <button
                    key={value}
                    type="button"
                    className={classes("seekite-facet", selected && "is-active")}
                    aria-pressed={selected}
                    onClick={() => controller.toggleFacet(field, value)}
                  >
                    {labelForValue(field, value, count)}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

export interface SearchEmptyProps extends HTMLAttributes<HTMLParagraphElement> {
  children?: ReactNode;
}

export function SearchEmpty({
  children = "No results found.",
  className,
  ...props
}: SearchEmptyProps) {
  const [state] = useSeekite();
  if (state.status !== "ready" || (state.response?.results.length ?? 0) > 0) return null;
  return (
    <p {...props} className={classes("seekite-empty", className)}>
      {children}
    </p>
  );
}

export interface SearchLoadMoreProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  children?: ReactNode;
}

export function SearchLoadMore({
  children = "Load more",
  className,
  disabled,
  onClick,
  ...props
}: SearchLoadMoreProps) {
  const [state, controller] = useSeekite();
  const response = state.response;
  if (!response || response.results.length === 0 || response.results.length >= response.total)
    return null;
  return (
    <button
      {...props}
      type="button"
      className={classes("seekite-load-more", className)}
      disabled={disabled || state.status === "loading"}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) controller.loadMore();
      }}
    >
      {children}
    </button>
  );
}

export const Search = {
  Input: SearchInput,
  Results: SearchResults,
  Result: SearchResult,
  Snippet: SearchSnippet,
  Facets: SearchFacets,
  Empty: SearchEmpty,
  LoadMore: SearchLoadMore,
} as const;
