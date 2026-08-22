import {
  snippet,
  type FilterPredicate,
  type FilterScalar,
  type FilterValue,
  type QueryOptions,
  type QueryResponse,
  type SearchClient,
  type SearchResult,
  type WhereClause,
} from "@seekite/core";

export const DEFAULT_DEBOUNCE_MS = 80;
export const LOADING_DELAY_MS = 150;
export const DEFAULT_RECENT_LIMIT = 8;

export type SearchUIStatus = "idle" | "loading" | "ready" | "error";
export type EscapeIntent = "cleared" | "closed";
export type SearchSnippet = ReturnType<typeof snippet>;

export interface SearchUIStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** SearchClient's transport surface with the format-v2 response contract. */
export type SearchUIClient = Omit<SearchClient, "query"> & {
  query(...args: Parameters<SearchClient["query"]>): Promise<QueryResponse>;
  warmup?(): Promise<void>;
};

export interface SearchUIState {
  open: boolean;
  query: string;
  status: SearchUIStatus;
  response?: QueryResponse;
  activeFilters: WhereClause;
  selectedIndex: number;
  recent: string[];
  error?: Error;
}

export interface SearchControllerOptions {
  client: SearchUIClient;
  queryOptions?: QueryOptions;
  debounceMs?: number;
  minLength?: number;
  recentStorageKey?: string | false;
  /** Optional storage override for non-browser hosts and deterministic tests. */
  storage?: SearchUIStorage;
  snippetOptions?: { radius?: number; maxRanges?: number };
}

export interface SearchController {
  getState(): SearchUIState;
  subscribe(listener: () => void): () => void;
  setQuery(value: string): void;
  setFilters(where: WhereClause): void;
  toggleFacet(field: string, value: string): void;
  loadMore(): void;
  moveSelection(delta: 1 | -1): void;
  selectResult(): SearchResult | undefined;
  snippetFor(result: SearchResult): SearchSnippet;
  /** Best-effort worker warmup plus configured-corpus loading. */
  prefetch(): Promise<void>;
  open(): void;
  close(): void;
  /** First call clears a non-empty query; the next closes the controller. */
  escape(): EscapeIntent;
  destroy(): void;
}

function normalizeInteger(value: number | undefined, fallback: number, minimum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.floor(value));
}

function isPredicate(value: FilterValue | FilterPredicate | undefined): value is FilterPredicate {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function immutableFilterValue(value: FilterValue | FilterPredicate): FilterValue | FilterPredicate {
  if (Array.isArray(value)) return Object.freeze([...value]) as FilterScalar[];
  if (isPredicate(value)) {
    const copy: FilterPredicate = { ...value };
    if (value.in) copy.in = Object.freeze([...value.in]) as FilterScalar[];
    return Object.freeze(copy);
  }
  return value;
}

function immutableWhere(where: WhereClause | undefined): WhereClause {
  const copy: WhereClause = {};
  for (const [field, value] of Object.entries(where ?? {})) {
    copy[field] = immutableFilterValue(value);
  }
  return Object.freeze(copy);
}

function immutableResult(result: SearchResult): SearchResult {
  if (
    Object.isFrozen(result) &&
    Object.isFrozen(result.terms) &&
    Object.isFrozen(result.document) &&
    (!result.document.chunks || Object.isFrozen(result.document.chunks))
  ) {
    return result;
  }

  const chunks = result.document.chunks?.map(immutableResult);
  return Object.freeze({
    ...result,
    metadata: result.metadata ? Object.freeze({ ...result.metadata }) : undefined,
    terms: Object.freeze(
      result.terms.map((term) => Object.freeze({ ...term })),
    ) as SearchResult["terms"],
    document: Object.freeze({
      ...result.document,
      chunks: chunks ? (Object.freeze(chunks) as SearchResult[]) : undefined,
    }),
  });
}

function immutableFacets(facets: QueryResponse["facets"]): QueryResponse["facets"] {
  if (!facets) return undefined;
  const copy: NonNullable<QueryResponse["facets"]> = {};
  for (const [field, counts] of Object.entries(facets)) {
    copy[field] = Object.freeze({ ...counts });
  }
  return Object.freeze(copy);
}

function immutableResponse(response: QueryResponse): QueryResponse {
  return Object.freeze({
    ...response,
    results: Object.freeze(response.results.map(immutableResult)) as SearchResult[],
    facets: immutableFacets(response.facets),
  });
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function browserStorage(): SearchUIStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function readRecent(storage: SearchUIStorage | undefined, key: string | false): string[] {
  if (!storage || key === false) return [];
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? "[]");
    if (!Array.isArray(value)) return [];
    const entries = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item !== "");
    return [...new Set(entries)].slice(0, DEFAULT_RECENT_LIMIT);
  } catch {
    return [];
  }
}

function predicateWithoutIn(value: FilterPredicate): FilterPredicate | undefined {
  const copy: FilterPredicate = { ...value };
  delete copy.in;
  return Object.values(copy).some((entry) => entry !== undefined) ? copy : undefined;
}

function facetValues(value: FilterValue | FilterPredicate | undefined): FilterScalar[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return [...value];
  if (isPredicate(value)) return [...(value.in ?? [])];
  return [value];
}

function toggledFacet(where: WhereClause, field: string, value: string): WhereClause {
  const next: WhereClause = { ...where };
  const current = where[field];
  const values = facetValues(current);
  const matchingIndex = values.findIndex((candidate) => String(candidate) === value);

  if (matchingIndex >= 0) values.splice(matchingIndex, 1);
  else values.push(value);

  if (isPredicate(current)) {
    const remainder = predicateWithoutIn(current);
    if (values.length > 0) next[field] = { ...remainder, in: values };
    else if (remainder) next[field] = remainder;
    else delete next[field];
  } else if (values.length > 0) {
    next[field] = { in: values };
  } else {
    delete next[field];
  }
  return next;
}

function copyQueryOptions(options: QueryOptions | undefined): QueryOptions {
  if (!options) return {};
  return {
    ...options,
    corpora: options.corpora ? [...options.corpora] : undefined,
    fields: options.fields ? { ...options.fields } : undefined,
    facets: options.facets ? [...options.facets] : undefined,
    where: immutableWhere(options.where),
  };
}

export function createSearchController(options: SearchControllerOptions): SearchController {
  const client = options.client;
  const baseQueryOptions = copyQueryOptions(options.queryOptions);
  const debounceMs = normalizeInteger(options.debounceMs, DEFAULT_DEBOUNCE_MS, 0);
  const minLength = normalizeInteger(options.minLength, 1, 0);
  const pageSize = normalizeInteger(baseQueryOptions.limit, 10, 1);
  const initialOffset = normalizeInteger(baseQueryOptions.offset, 0, 0);
  const snippetOptions = options.snippetOptions ? { ...options.snippetOptions } : undefined;
  const recentKey = options.recentStorageKey ?? false;
  const storage = recentKey === false ? undefined : (options.storage ?? browserStorage());
  const listeners = new Set<() => void>();
  let snippets = new WeakMap<SearchResult, SearchSnippet>();
  let destroyed = false;
  let revision = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let loadingTimer: ReturnType<typeof setTimeout> | undefined;
  let loadingPage = false;
  let prefetchPromise: Promise<void> | undefined;

  let state: SearchUIState = Object.freeze({
    open: false,
    query: "",
    status: "idle",
    response: undefined,
    activeFilters: immutableWhere(baseQueryOptions.where),
    selectedIndex: -1,
    recent: Object.freeze(readRecent(storage, recentKey)) as string[],
    error: undefined,
  });

  const notify = (): void => {
    for (const listener of Array.from(listeners)) listener();
  };

  const transition = (patch: Partial<SearchUIState>): void => {
    if (destroyed) return;
    state = Object.freeze({ ...state, ...patch });
    notify();
  };

  const clearTimers = (): void => {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    if (loadingTimer !== undefined) clearTimeout(loadingTimer);
    debounceTimer = undefined;
    loadingTimer = undefined;
  };

  const queryOptionsAt = (offset: number): QueryOptions => ({
    ...baseQueryOptions,
    corpora: baseQueryOptions.corpora ? [...baseQueryOptions.corpora] : undefined,
    fields: baseQueryOptions.fields ? { ...baseQueryOptions.fields } : undefined,
    facets: baseQueryOptions.facets ? [...baseQueryOptions.facets] : undefined,
    where: state.activeFilters,
    limit: pageSize,
    offset,
  });

  const runQuery = async (
    requestRevision: number,
    offset: number,
    append: boolean,
  ): Promise<void> => {
    if (destroyed || requestRevision !== revision) return;
    const timer = setTimeout(() => {
      if (destroyed || requestRevision !== revision) return;
      transition({ status: "loading", error: undefined });
    }, LOADING_DELAY_MS);
    loadingTimer = timer;

    try {
      const response = await client.query(state.query, queryOptionsAt(offset));
      if (destroyed || requestRevision !== revision) return;
      clearTimeout(timer);
      if (loadingTimer === timer) loadingTimer = undefined;

      const complete =
        append && state.response
          ? immutableResponse({
              ...response,
              results: [...state.response.results, ...response.results],
              facets: response.facets ?? state.response.facets,
            })
          : immutableResponse(response);
      const selectedIndex =
        complete.results.length === 0
          ? -1
          : append && state.selectedIndex >= 0
            ? Math.min(state.selectedIndex, complete.results.length - 1)
            : 0;
      loadingPage = false;
      transition({
        status: "ready",
        response: complete,
        selectedIndex,
        error: undefined,
      });
    } catch (error) {
      if (destroyed || requestRevision !== revision) return;
      clearTimeout(timer);
      if (loadingTimer === timer) loadingTimer = undefined;
      loadingPage = false;
      transition({ status: "error", error: normalizeError(error) });
    }
  };

  const scheduleFreshQuery = (patch: Partial<SearchUIState>): void => {
    if (destroyed) return;
    revision += 1;
    loadingPage = false;
    clearTimers();
    const requestRevision = revision;
    const nextQuery = patch.query ?? state.query;
    transition({
      ...patch,
      status: "idle",
      response: undefined,
      selectedIndex: -1,
      error: undefined,
    });

    if (nextQuery.trim().length < minLength) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void runQuery(requestRevision, initialOffset, false);
    }, debounceMs);
  };

  const setQuery = (value: string): void => {
    if (destroyed || value === state.query) return;
    scheduleFreshQuery({ query: value });
  };

  const setFilters = (where: WhereClause): void => {
    if (destroyed) return;
    scheduleFreshQuery({ activeFilters: immutableWhere(where) });
  };

  const toggleFacet = (field: string, value: string): void => {
    if (destroyed || field === "") return;
    setFilters(toggledFacet(state.activeFilters, field, value));
  };

  const loadMore = (): void => {
    if (destroyed || loadingPage || !state.response) return;
    if (
      state.query.trim().length < minLength ||
      initialOffset + state.response.results.length >= state.response.total
    )
      return;
    revision += 1;
    clearTimers();
    loadingPage = true;
    void runQuery(revision, initialOffset + state.response.results.length, true);
  };

  const moveSelection = (delta: 1 | -1): void => {
    if (destroyed) return;
    const count = state.response?.results.length ?? 0;
    if (count === 0) {
      if (state.selectedIndex !== -1) transition({ selectedIndex: -1 });
      return;
    }
    const selectedIndex =
      state.selectedIndex < 0
        ? delta === 1
          ? 0
          : count - 1
        : (state.selectedIndex + delta + count) % count;
    if (selectedIndex !== state.selectedIndex) transition({ selectedIndex });
  };

  const persistRecent = (recent: string[]): void => {
    if (!storage || recentKey === false) return;
    try {
      storage.setItem(recentKey, JSON.stringify(recent));
    } catch {
      // Search remains usable when storage is blocked, full, or unavailable.
    }
  };

  const selectResult = (): SearchResult | undefined => {
    if (destroyed || state.selectedIndex < 0) return undefined;
    const result = state.response?.results[state.selectedIndex];
    if (!result) return undefined;
    const query = state.query.trim();
    if (query !== "") {
      const recent = Object.freeze(
        [query, ...state.recent.filter((item) => item !== query)].slice(0, DEFAULT_RECENT_LIMIT),
      ) as string[];
      transition({ recent });
      persistRecent(recent);
    }
    return result;
  };

  const snippetFor = (result: SearchResult): SearchSnippet => {
    const cached = snippets.get(result);
    if (cached) return cached;
    const value = snippet(result.content, result.terms, snippetOptions);
    snippets.set(result, value);
    return value;
  };

  const prefetch = (): Promise<void> => {
    if (destroyed) return Promise.resolve();
    if (prefetchPromise) return prefetchPromise;
    const corpora = [...new Set(baseQueryOptions.corpora ?? [])];
    const tasks: Array<Promise<unknown>> = corpora.map((corpus) =>
      Promise.resolve().then(() => client.load(corpus)),
    );
    if (client.warmup) tasks.unshift(Promise.resolve().then(() => client.warmup?.()));

    prefetchPromise = Promise.all(tasks).then(
      () => undefined,
      () => {
        prefetchPromise = undefined;
      },
    );
    return prefetchPromise;
  };

  const open = (): void => {
    if (destroyed) return;
    if (!state.open) transition({ open: true });
    void prefetch();
  };

  const close = (): void => {
    if (destroyed || !state.open) return;
    transition({ open: false, selectedIndex: -1 });
  };

  const escape = (): EscapeIntent => {
    if (destroyed) return "closed";
    if (state.query !== "") {
      setQuery("");
      return "cleared";
    }
    close();
    return "closed";
  };

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    revision += 1;
    clearTimers();
    loadingPage = false;
    listeners.clear();
    snippets = new WeakMap();
  };

  return {
    getState: () => state,
    subscribe(listener) {
      if (destroyed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setQuery,
    setFilters,
    toggleFacet,
    loadMore,
    moveSelection,
    selectResult,
    snippetFor,
    prefetch,
    open,
    close,
    escape,
    destroy,
  };
}
