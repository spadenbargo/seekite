import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { QueryOptions, QueryResponse, SearchResult, WhereClause } from "@seekite/core";
import {
  LOADING_DELAY_MS,
  createSearchController,
  type SearchUIClient,
  type SearchUIStorage,
} from "./controller.js";

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(error: unknown): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function result(id: string, overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id,
    documentId: id,
    url: `/${id}`,
    title: `Result ${id}`,
    content: `Use the canvas ${id} drawing API`,
    corpus: "docs",
    score: 1,
    lexicalScore: 1,
    terms: [{ term: "canvas", source: "canvas", kind: "exact" }],
    document: { id, matches: 1 },
    ...overrides,
  };
}

function response(results: SearchResult[], total = results.length): QueryResponse {
  return { results, total, facets: { tags: { vite: 2, astro: 1 } } };
}

function fakeClient(
  queryImplementation: (
    query: string,
    options?: QueryOptions,
  ) => Promise<QueryResponse> = async () => response([]),
): SearchUIClient & {
  query: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
  warmup: ReturnType<typeof vi.fn>;
} {
  const loaded = new Set<string>();
  const load = vi.fn(async (corpus: string) => {
    loaded.add(corpus);
  });
  return {
    load,
    loaded: () => [...loaded],
    query: vi.fn(queryImplementation),
    warmup: vi.fn(async () => undefined),
  };
}

class MemoryStorage implements SearchUIStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createSearchController", () => {
  it("publishes stable immutable snapshots and supports clean unsubscription", () => {
    const controller = createSearchController({ client: fakeClient() });
    const initial = controller.getState();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);

    expect(controller.getState()).toBe(initial);
    expect(Object.isFrozen(initial)).toBe(true);
    expect(Object.isFrozen(initial.activeFilters)).toBe(true);
    expect(Object.isFrozen(initial.recent)).toBe(true);

    const input: WhereClause = { tags: { in: ["vite"] } };
    controller.setFilters(input);
    const changed = controller.getState();
    expect(changed).not.toBe(initial);
    expect(initial.activeFilters).toEqual({});
    expect(changed.activeFilters).toEqual({ tags: { in: ["vite"] } });
    expect(Object.isFrozen((changed.activeFilters.tags as { in: string[] }).in)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    (input.tags as { in: string[] }).in.push("mutated outside");
    expect(changed.activeFilters).toEqual({ tags: { in: ["vite"] } });

    unsubscribe();
    controller.setQuery("next");
    expect(listener).toHaveBeenCalledTimes(1);
    controller.destroy();
  });

  it("debounces input and delays loading for slow searches without fast-query flicker", async () => {
    vi.useFakeTimers();
    const slow = deferred<QueryResponse>();
    const client = fakeClient(() => slow.promise);
    const controller = createSearchController({ client, debounceMs: 80 });

    controller.setQuery("canvas");
    await vi.advanceTimersByTimeAsync(79);
    expect(client.query).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe("idle");

    await vi.advanceTimersByTimeAsync(1);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(controller.getState().status).toBe("idle");
    await vi.advanceTimersByTimeAsync(LOADING_DELAY_MS - 1);
    expect(controller.getState().status).toBe("idle");
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.getState().status).toBe("loading");

    slow.resolve(response([result("slow")]));
    await flush();
    expect(controller.getState()).toMatchObject({ status: "ready", selectedIndex: 0 });

    const statuses: string[] = [];
    const fastClient = fakeClient(async () => response([result("fast")]));
    const fast = createSearchController({ client: fastClient, debounceMs: 0 });
    fast.subscribe(() => statuses.push(fast.getState().status));
    fast.setQuery("instant");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(LOADING_DELAY_MS);
    expect(fast.getState().status).toBe("ready");
    expect(statuses).not.toContain("loading");

    controller.destroy();
    fast.destroy();
  });

  it("drops stale successes and failures using monotonic request revisions", async () => {
    vi.useFakeTimers();
    const requests = new Map<string, Deferred<QueryResponse>>();
    const client = fakeClient((query) => {
      const request = requests.get(query);
      if (!request) throw new Error(`missing scripted request for ${query}`);
      return request.promise;
    });
    const controller = createSearchController({ client, debounceMs: 0 });

    const slow = deferred<QueryResponse>();
    const fast = deferred<QueryResponse>();
    requests.set("slow", slow);
    requests.set("fast", fast);
    controller.setQuery("slow");
    await vi.advanceTimersByTimeAsync(0);
    controller.setQuery("fast");
    await vi.advanceTimersByTimeAsync(0);

    fast.resolve(response([result("fast")]));
    await flush();
    const latest = controller.getState();
    expect(latest.response?.results[0]?.id).toBe("fast");

    slow.resolve(response([result("stale success")]));
    await flush();
    expect(controller.getState()).toBe(latest);
    expect(controller.getState().error).toBeUndefined();

    const staleFailure = deferred<QueryResponse>();
    const newest = deferred<QueryResponse>();
    requests.set("stale failure", staleFailure);
    requests.set("newest", newest);
    controller.setQuery("stale failure");
    await vi.advanceTimersByTimeAsync(0);
    controller.setQuery("newest");
    await vi.advanceTimersByTimeAsync(0);
    newest.resolve(response([result("newest")]));
    await flush();
    const newestState = controller.getState();
    staleFailure.reject(new Error("stale failure"));
    await flush();
    expect(controller.getState()).toBe(newestState);
    expect(controller.getState().response?.results[0]?.id).toBe("newest");

    controller.destroy();
  });

  it("maintains facet `in` predicates without losing unrelated where clauses", async () => {
    vi.useFakeTimers();
    const initial: WhereClause = {
      version: "2.x",
      stars: { gte: 3 },
      tags: { exists: true, in: ["vite"] },
    };
    const client = fakeClient();
    const controller = createSearchController({
      client,
      debounceMs: 0,
      queryOptions: { where: initial, facets: ["tags"] },
    });
    controller.setQuery("plugins");
    await vi.advanceTimersByTimeAsync(0);

    controller.toggleFacet("tags", "astro");
    expect(controller.getState().activeFilters).toEqual({
      version: "2.x",
      stars: { gte: 3 },
      tags: { exists: true, in: ["vite", "astro"] },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(client.query.mock.calls.at(-1)?.[1]).toMatchObject({
      where: { tags: { exists: true, in: ["vite", "astro"] } },
    });

    controller.toggleFacet("tags", "vite");
    expect(controller.getState().activeFilters.tags).toEqual({ exists: true, in: ["astro"] });
    controller.toggleFacet("tags", "astro");
    expect(controller.getState().activeFilters).toEqual({
      version: "2.x",
      stars: { gte: 3 },
      tags: { exists: true },
    });
    expect(initial).toEqual({
      version: "2.x",
      stars: { gte: 3 },
      tags: { exists: true, in: ["vite"] },
    });

    controller.destroy();
  });

  it("prefetches once by warming the client and loading each configured corpus", async () => {
    const client = fakeClient();
    const controller = createSearchController({
      client,
      queryOptions: { corpora: ["docs", "api", "docs"] },
    });

    const first = controller.prefetch();
    const second = controller.prefetch();
    expect(second).toBe(first);
    await first;
    expect(client.warmup).toHaveBeenCalledTimes(1);
    expect(client.load.mock.calls.map(([corpus]) => corpus)).toEqual(["docs", "api"]);

    controller.open();
    expect(controller.getState().open).toBe(true);
    expect(client.warmup).toHaveBeenCalledTimes(1);
    expect(client.load).toHaveBeenCalledTimes(2);
    controller.close();
    expect(controller.getState().open).toBe(false);

    controller.destroy();
  });

  it("treats prefetch failures as retryable best-effort work", async () => {
    const client = fakeClient();
    client.warmup
      .mockImplementationOnce(() => {
        throw new Error("worker unavailable");
      })
      .mockResolvedValueOnce(undefined);
    const controller = createSearchController({ client });

    await expect(controller.prefetch()).resolves.toBeUndefined();
    expect(controller.getState().status).toBe("idle");
    await expect(controller.prefetch()).resolves.toBeUndefined();
    expect(client.warmup).toHaveBeenCalledTimes(2);

    controller.destroy();
  });

  it("appends offset pages, preserves selection, and stops at total", async () => {
    vi.useFakeTimers();
    const pages = [response([result("a"), result("b")], 8), response([result("c")], 8)];
    const client = fakeClient(async () => pages.shift() ?? response([], 8));
    const controller = createSearchController({
      client,
      debounceMs: 0,
      queryOptions: { limit: 2, offset: 5 },
    });

    controller.setQuery("canvas");
    await vi.advanceTimersByTimeAsync(0);
    expect(client.query.mock.calls[0]?.[1]).toMatchObject({ limit: 2, offset: 5 });
    expect(controller.getState().response?.results.map(({ id }) => id)).toEqual(["a", "b"]);
    controller.moveSelection(-1);
    expect(controller.getState().selectedIndex).toBe(1);

    controller.loadMore();
    expect(client.query.mock.calls.at(-1)?.[1]).toMatchObject({ limit: 2, offset: 7 });
    await flush();
    expect(controller.getState().response?.results.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(controller.getState().selectedIndex).toBe(1);

    controller.loadMore();
    expect(client.query).toHaveBeenCalledTimes(2);
    controller.destroy();
  });

  it("wraps selection, persists selected queries, and applies two-stage Escape", async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const client = fakeClient(async () => response([result("a"), result("b")]));
    const controller = createSearchController({
      client,
      debounceMs: 0,
      recentStorageKey: "seekite:recent",
      storage,
    });
    controller.open();
    controller.setQuery("  canvas  ");
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.getState().selectedIndex).toBe(0);
    controller.moveSelection(-1);
    expect(controller.getState().selectedIndex).toBe(1);
    expect(controller.selectResult()?.id).toBe("b");
    expect(controller.getState().recent).toEqual(["canvas"]);
    expect(JSON.parse(storage.getItem("seekite:recent") ?? "[]")).toEqual(["canvas"]);

    controller.moveSelection(1);
    expect(controller.getState().selectedIndex).toBe(0);
    controller.moveSelection(-1);
    expect(controller.getState().selectedIndex).toBe(1);

    expect(controller.escape()).toBe("cleared");
    expect(controller.getState()).toMatchObject({ open: true, query: "", selectedIndex: -1 });
    expect(controller.escape()).toBe("closed");
    expect(controller.getState().open).toBe(false);

    const restored = createSearchController({
      client: fakeClient(),
      recentStorageKey: "seekite:recent",
      storage,
    });
    expect(restored.getState().recent).toEqual(["canvas"]);

    controller.destroy();
    restored.destroy();
  });

  it("memoizes snippets by result identity", () => {
    const controller = createSearchController({
      client: fakeClient(),
      snippetOptions: { radius: 12, maxRanges: 2 },
    });
    const match = result("memo");
    const first = controller.snippetFor(match);
    const second = controller.snippetFor(match);

    expect(second).toBe(first);
    expect(first.text.toLocaleLowerCase()).toContain("canvas");
    expect(first.ranges.length).toBeGreaterThan(0);
    expect(controller.snippetFor(result("other"))).not.toBe(first);

    controller.destroy();
  });

  it("surfaces current query errors after the delayed loading state", async () => {
    vi.useFakeTimers();
    const failure = deferred<QueryResponse>();
    const controller = createSearchController({
      client: fakeClient(() => failure.promise),
      debounceMs: 0,
    });
    controller.setQuery("broken");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(LOADING_DELAY_MS);
    expect(controller.getState().status).toBe("loading");

    failure.reject("network unavailable");
    await flush();
    expect(controller.getState()).toMatchObject({
      status: "error",
      error: expect.objectContaining({ message: "network unavailable" }),
    });

    controller.destroy();
  });

  it("cancels timers and ignores active work after destroy", async () => {
    vi.useFakeTimers();
    const pending = deferred<QueryResponse>();
    const client = fakeClient(() => pending.promise);
    const controller = createSearchController({ client, debounceMs: 0 });
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.setQuery("long running");
    await vi.advanceTimersByTimeAsync(0);
    const beforeDestroy = controller.getState();
    const notifications = listener.mock.calls.length;

    controller.destroy();
    await vi.advanceTimersByTimeAsync(LOADING_DELAY_MS * 2);
    pending.resolve(response([result("late")]));
    await flush();

    expect(controller.getState()).toBe(beforeDestroy);
    expect(listener).toHaveBeenCalledTimes(notifications);
    controller.setQuery("ignored");
    controller.open();
    expect(controller.getState()).toBe(beforeDestroy);
  });

  it("does not query below minLength", async () => {
    vi.useFakeTimers();
    const client = fakeClient();
    const controller = createSearchController({ client, debounceMs: 0, minLength: 3 });

    controller.setQuery("ab");
    await vi.runAllTimersAsync();
    expect(client.query).not.toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({ status: "idle", response: undefined });

    controller.destroy();
  });
});
