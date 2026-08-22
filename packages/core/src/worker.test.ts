import { describe, expect, it, vi } from "vite-plus/test";
import { encodeLexicalV2 } from "./codec.js";
import { createLexicalIndexV2 } from "./lexical.js";
import { createSearch, resolveIndexURL, type SearchClient } from "./runtime.js";
import type { CorpusMetadataV2, SearchManifestV2 } from "./types.js";
import { exposeSearch, workerSearch, type WorkerMessageEndpoint } from "./worker.js";

type Listener = (event: unknown) => void;
type QueryResult = Awaited<ReturnType<SearchClient["query"]>>;

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

function queryResult(value: unknown): QueryResult {
  return value as QueryResult;
}

function fakeSearch(query?: SearchClient["query"]): SearchClient {
  const corpora = new Set<string>();
  return {
    async load(corpus) {
      corpora.add(corpus);
    },
    query: query ?? (async (value) => queryResult([{ value }])),
    loaded: () => [...corpora],
  };
}

class BrowserPort implements WorkerMessageEndpoint {
  peer?: BrowserPort;
  readonly sent: unknown[] = [];
  terminated = false;
  private readonly listeners = new Map<string, Set<Listener>>();

  postMessage(message: unknown): void {
    if (this.terminated) throw new Error("port is terminated");
    const cloned = structuredClone(message);
    this.sent.push(cloned);
    queueMicrotask(() => {
      if (!this.peer?.terminated) this.peer?.emit("message", { data: cloned });
    });
  }

  addEventListener(type: string, listener: Listener): void {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  start(): void {}

  terminate(): void {
    this.terminated = true;
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  crash(error: Error): void {
    this.emit("error", {
      error,
      message: error.message,
      preventDefault: vi.fn(),
    });
  }
}

class NodePort implements WorkerMessageEndpoint {
  peer?: NodePort;
  readonly sent: unknown[] = [];
  terminated = false;
  private readonly listeners = new Map<string, Set<Listener>>();

  postMessage(message: unknown): void {
    if (this.terminated) throw new Error("port is terminated");
    const cloned = structuredClone(message);
    this.sent.push(cloned);
    queueMicrotask(() => {
      if (!this.peer?.terminated) this.peer?.emit("message", cloned);
    });
  }

  on(type: string, listener: Listener): this {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
    return this;
  }

  off(type: string, listener: Listener): this {
    this.listeners.get(type)?.delete(listener);
    return this;
  }

  start(): void {}

  terminate(): void {
    this.terminated = true;
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function browserPorts(): [main: BrowserPort, worker: BrowserPort] {
  const main = new BrowserPort();
  const worker = new BrowserPort();
  main.peer = worker;
  worker.peer = main;
  return [main, worker];
}

function nodePorts(): [main: NodePort, worker: NodePort] {
  const main = new NodePort();
  const worker = new NodePort();
  main.peer = worker;
  worker.peer = main;
  return [main, worker];
}

describe("worker search protocol", () => {
  it("returns the same format-v2 ranking and nested response as a direct client", async () => {
    const chunks = [
      {
        id: "canvas-intro",
        documentId: "canvas",
        url: "/canvas",
        title: "Canvas",
        heading: "Drawing",
        content: "Draw shapes with the canvas API",
      },
      {
        id: "canvas-api",
        documentId: "canvas",
        url: "/canvas#api",
        title: "Canvas API",
        heading: "Reference",
        content: "Canvas rendering context methods",
      },
      {
        id: "auth",
        documentId: "auth",
        url: "/auth",
        title: "Authentication",
        heading: "OAuth",
        content: "Configure OAuth providers",
      },
    ];
    const analyzer = { folding: true, stemmer: null } as const;
    const lexical = encodeLexicalV2(createLexicalIndexV2(chunks, analyzer), 24);
    const metadata: CorpusMetadataV2 = {
      version: 2,
      name: "docs",
      documents: ["canvas", "auth"],
      chunks: {
        id: chunks.map((chunk) => chunk.id),
        document: [0, 0, 1],
        url: chunks.map((chunk) => chunk.url),
        title: chunks.map((chunk) => chunk.title),
        heading: chunks.map((chunk) => chunk.heading),
        content: [
          [0, 0],
          [0, 1],
          [0, 2],
        ],
        filters: { tags: [["graphics"], ["graphics"], ["security"]] },
      },
      facets: { tags: { graphics: 2, security: 1 } },
    };
    const manifest: SearchManifestV2 = {
      format: "seekite",
      version: 2,
      generatedAt: "2026-01-01T00:00:00.000Z",
      corpora: {
        docs: {
          name: "docs",
          path: "docs",
          chunks: chunks.length,
          format: 2,
          corpus: "corpus.json",
          lexical: { dictionary: "lexical/dictionary.bin", shards: lexical.shards.length },
          content: { prefix: "content/content-", shards: 1 },
          analyzer,
        },
      },
    };
    const assets = new Map<string, string | Uint8Array>([
      ["/search/manifest.json", JSON.stringify(manifest)],
      ["/search/docs/corpus.json", JSON.stringify(metadata)],
      ["/search/docs/lexical/dictionary.bin", lexical.dictionary],
      [
        "/search/docs/content/content-000.json",
        JSON.stringify({
          version: 2,
          chunks: chunks.map((chunk) => ({ content: chunk.content })),
        }),
      ],
      ...lexical.shards.map((shard, index): [string, Uint8Array] => [
        `/search/docs/lexical/postings-${String(index).padStart(3, "0")}.bin`,
        shard,
      ]),
    ]);
    const fetcher: typeof fetch = async (input) => {
      const body = assets.get(String(input));
      return body === undefined ? new Response(null, { status: 404 }) : new Response(body);
    };
    const direct = createSearch({ fetch: fetcher });
    const [main, worker] = browserPorts();
    exposeSearch(createSearch({ fetch: fetcher }), worker);
    const proxied = workerSearch(() => main);

    const options = { mode: "lexical", group: "expanded", facets: ["tags"] } as const;
    const directResponse = await direct.query("canvas ", options);
    await expect(proxied.query("canvas ", options)).resolves.toEqual(directResponse);
    expect(directResponse.results[0]?.document.chunks).toHaveLength(2);
    expect(directResponse.facets).toEqual({ tags: { graphics: 1 } });
    await proxied.destroy();
  });

  it("resolves a build-relative index key without a document global", () => {
    vi.stubGlobal("document", undefined);
    try {
      expect(resolveIndexURL({ key: "assets/search" })).toBe("/assets/search");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("spawns lazily, queues calls during async spawn, and tracks loaded corpora", async () => {
    const [main, worker] = browserPorts();
    exposeSearch(fakeSearch(), worker);
    const spawn = deferred<WorkerMessageEndpoint>();
    const factory = vi.fn(() => spawn.promise);
    const search = workerSearch(factory);

    expect(factory).not.toHaveBeenCalled();
    expect(search.loaded()).toEqual([]);

    const first = search.load("docs");
    const second = search.load("api");
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    spawn.resolve(main);
    await Promise.all([first, second]);

    expect(new Set(search.loaded())).toEqual(new Set(["docs", "api"]));
    await search.destroy();
  });

  it("matches interleaved responses to the correct request", async () => {
    const [main, worker] = browserPorts();
    const gates = new Map([
      ["slow", deferred<void>()],
      ["fast", deferred<void>()],
    ]);
    const started: string[] = [];
    const completed: string[] = [];
    const query: SearchClient["query"] = async (value) => {
      started.push(value);
      await gates.get(value)?.promise;
      completed.push(value);
      return queryResult([value]);
    };
    exposeSearch(fakeSearch(query), worker);
    const search = workerSearch(() => main);

    const slow = search.query("slow");
    const fast = search.query("fast");
    await vi.waitFor(() => expect(started).toEqual(["slow", "fast"]));
    gates.get("fast")?.resolve();
    await expect(fast).resolves.toEqual(["fast"]);
    expect(completed).toEqual(["fast"]);
    gates.get("slow")?.resolve();
    await expect(slow).resolves.toEqual(["slow"]);

    await search.destroy();
  });

  it("adapts node:worker_threads raw message event shapes", async () => {
    const [main, worker] = nodePorts();
    exposeSearch(
      fakeSearch(async (value) => queryResult([{ value, transport: "node" }])),
      worker,
    );
    const search = workerSearch(() => main);

    await search.load("docs");
    await expect(search.query("worker threads")).resolves.toEqual([
      { value: "worker threads", transport: "node" },
    ]);
    expect(search.loaded()).toEqual(["docs"]);

    await search.destroy();
  });

  it("transfers failures as plain data and reconstructs the error name", async () => {
    const [main, worker] = browserPorts();
    const query: SearchClient["query"] = async () => {
      throw new RangeError("query exploded");
    };
    exposeSearch(fakeSearch(query), worker);
    const search = workerSearch(() => main);

    await expect(search.query("boom")).rejects.toMatchObject({
      name: "RangeError",
      message: "query exploded",
    });
    const response = worker.sent.at(-1) as { error: unknown };
    expect(response.error).toEqual({ name: "RangeError", message: "query exploded" });
    expect(response.error).not.toBeInstanceOf(Error);

    await search.destroy();
  });

  it("turns an uncloneable result into a clone-safe RPC failure", async () => {
    const [main, worker] = browserPorts();
    const query: SearchClient["query"] = async () =>
      queryResult({ accidentallyLive: () => undefined });
    exposeSearch(fakeSearch(query), worker);
    const search = workerSearch(() => main);

    await expect(search.query("uncloneable")).rejects.toMatchObject({
      name: "DataCloneError",
    });
    const response = worker.sent.at(-1) as { error: unknown };
    expect(response.error).not.toBeInstanceOf(Error);

    await search.destroy();
  });

  it("rejects in-flight calls after a crash and respawns on the next call", async () => {
    const never = deferred<QueryResult>();
    const started = deferred<void>();
    const mainPorts: BrowserPort[] = [];
    let generation = 0;
    const factory = vi.fn(() => {
      generation += 1;
      const [main, worker] = browserPorts();
      mainPorts.push(main);
      const query: SearchClient["query"] =
        generation === 1
          ? async () => {
              started.resolve();
              return never.promise;
            }
          : async (value) => queryResult([`generation-2:${value}`]);
      exposeSearch(fakeSearch(query), worker);
      return main;
    });
    const search = workerSearch(factory);

    const pending = search.query("before crash");
    await started.promise;
    mainPorts[0]?.crash(new Error("worker crashed hard"));
    await expect(pending).rejects.toThrow("worker crashed hard");
    expect(mainPorts[0]?.terminated).toBe(true);

    await expect(search.query("after crash")).resolves.toEqual(["generation-2:after crash"]);
    expect(factory).toHaveBeenCalledTimes(2);

    await search.destroy();
  });

  it("warms an extended client without transferring a query result", async () => {
    const [main, worker] = browserPorts();
    const warmup = vi.fn(async () => undefined);
    const client = Object.assign(fakeSearch(), { warmup });
    exposeSearch(client, worker);
    const search = workerSearch(() => main);

    await search.warmup();
    expect(warmup).toHaveBeenCalledTimes(1);

    await search.destroy();
  });

  it("falls back to an empty query when the underlying client has no warmup hook", async () => {
    const [main, worker] = browserPorts();
    const query = vi.fn<SearchClient["query"]>(async () => queryResult([]));
    exposeSearch(fakeSearch(query), worker);
    const search = workerSearch(() => main);

    await search.warmup();
    expect(query).toHaveBeenCalledWith("");

    await search.destroy();
  });

  it("terminates cleanly, rejects pending work, and cannot restart", async () => {
    const [main, worker] = browserPorts();
    const started = deferred<void>();
    const query: SearchClient["query"] = async () => {
      started.resolve();
      return new Promise<QueryResult>(() => undefined);
    };
    exposeSearch(fakeSearch(query), worker);
    const search = workerSearch(() => main);

    const pending = search.query("long query");
    await started.promise;
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await search.terminate();

    await rejected;
    await expect(search.query("too late")).rejects.toMatchObject({ name: "AbortError" });
    expect(main.terminated).toBe(true);
  });

  it("rejects calls still queued in an asynchronous factory when destroyed", async () => {
    const spawn = deferred<WorkerMessageEndpoint>();
    const factory = vi.fn(() => spawn.promise);
    const search = workerSearch(factory);
    const pending = search.query("still spawning");
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });

    await search.destroy();

    await rejected;
  });

  it("gives SSR worker-construction failures actionable guidance", async () => {
    const search = workerSearch(() => {
      throw new ReferenceError("Worker is not defined");
    });

    await expect(search.warmup()).rejects.toThrow(/lazily in the browser rather than during SSR/);
  });
});
