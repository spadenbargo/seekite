/* oxlint-disable unicorn/require-post-message-target-origin -- These endpoints are workers, not Window. */

import type { SearchClient } from "./runtime.js";

type RpcMethod = "load" | "query" | "loaded" | "warmup";

interface RpcRequest {
  id: number;
  method: RpcMethod;
  args: unknown[];
}

interface SerializedError {
  name: string;
  message: string;
}

interface RpcSuccess {
  id: number;
  result: unknown;
  loaded: string[];
}

interface RpcFailure {
  id: number;
  error: SerializedError;
}

type RpcResponse = RpcSuccess | RpcFailure;

/** The common surface shared by a Web Worker and a Node `MessagePort`/`Worker`. */
export interface WorkerMessageEndpoint {
  postMessage(message: unknown): void;
}

interface RuntimeEndpoint extends WorkerMessageEndpoint {
  addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener?: (type: string, listener: (event: unknown) => void) => void;
  on?: (type: string, listener: (event: unknown) => void) => unknown;
  off?: (type: string, listener: (event: unknown) => void) => unknown;
  removeListener?: (type: string, listener: (event: unknown) => void) => unknown;
  start?: () => void;
  close?: () => void;
  terminate?: () => unknown;
}

export type WorkerFactory = () => WorkerMessageEndpoint | PromiseLike<WorkerMessageEndpoint>;

export type WorkerSearchClient<Client extends SearchClient = SearchClient> = Pick<
  Client,
  "load" | "query" | "loaded"
> & {
  /** Spawn the worker and initialize the search runtime before the first user query. */
  warmup(): Promise<void>;
  /** Permanently stop this proxy and reject all outstanding calls. */
  terminate(): Promise<void>;
  /** Alias for {@link terminate}. */
  destroy(): Promise<void>;
};

interface PendingCall {
  resolve(value: unknown): void;
  reject(reason: Error): void;
}

type ContainsCallable<Value, Seen = never> = Value extends CallableFunction
  ? true
  : Value extends Seen
    ? false
    : Value extends readonly (infer Item)[]
      ? ContainsCallable<Item, Seen | Value>
      : Value extends object
        ? true extends {
            [Key in keyof Value]-?: ContainsCallable<NonNullable<Value[Key]>, Seen | Value>;
          }[keyof Value]
          ? true
          : false
        : false;

type AssertFalse<Value extends false> = Value;

// Query results cross the worker boundary. Keep this assertion next to the
// transport so a future result-shape change cannot quietly add live functions.
type _QueryResultMustContainNoFunctions = AssertFalse<
  ContainsCallable<Awaited<ReturnType<SearchClient["query"]>>>
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function messageData(event: unknown): unknown {
  // Browser EventTarget listeners receive MessageEvent; node:worker_threads
  // EventEmitter listeners receive the payload directly.
  if (isRecord(event) && !("id" in event) && "data" in event) return event["data"];
  return event;
}

function isRpcMethod(value: unknown): value is RpcMethod {
  return value === "load" || value === "query" || value === "loaded" || value === "warmup";
}

function isRpcRequest(value: unknown): value is RpcRequest {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value["id"]) &&
    isRpcMethod(value["method"]) &&
    Array.isArray(value["args"])
  );
}

function isRpcResponse(value: unknown): value is RpcResponse {
  if (!isRecord(value) || !Number.isSafeInteger(value["id"])) return false;
  if ("error" in value) {
    return (
      isRecord(value["error"]) &&
      typeof value["error"]["name"] === "string" &&
      typeof value["error"]["message"] === "string"
    );
  }
  return (
    "result" in value &&
    Array.isArray(value["loaded"]) &&
    value["loaded"].every((corpus) => typeof corpus === "string")
  );
}

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) return { name: error.name || "Error", message: error.message };
  return { name: "Error", message: String(error) };
}

function remoteError(error: SerializedError): Error {
  const result = new Error(error.message);
  result.name = error.name;
  return result;
}

function eventError(event: unknown, fallback: string): Error {
  if (event instanceof Error) return event;
  if (isRecord(event)) {
    if (event["error"] instanceof Error) return event["error"];
    if (typeof event["message"] === "string") {
      const result = new Error(event["message"]);
      result.name = typeof event["name"] === "string" ? event["name"] : "WorkerError";
      return result;
    }
  }
  const result = new Error(fallback);
  result.name = "WorkerError";
  return result;
}

function endpointOf(value: WorkerMessageEndpoint): RuntimeEndpoint {
  const endpoint = value as RuntimeEndpoint;
  if (
    !endpoint ||
    typeof endpoint.postMessage !== "function" ||
    (typeof endpoint.addEventListener !== "function" && typeof endpoint.on !== "function")
  ) {
    throw new TypeError("Seekite worker factory must return a Worker or MessagePort-like endpoint");
  }
  return endpoint;
}

function listen(
  endpoint: RuntimeEndpoint,
  type: "message" | "messageerror" | "error" | "exit",
  listener: (event: unknown) => void,
): () => void {
  if (type !== "exit" && endpoint.addEventListener) {
    endpoint.addEventListener(type, listener);
    return () => endpoint.removeEventListener?.(type, listener);
  }
  if (endpoint.on) {
    endpoint.on(type, listener);
    return () => {
      if (endpoint.off) endpoint.off(type, listener);
      else endpoint.removeListener?.(type, listener);
    };
  }
  return () => undefined;
}

async function stopEndpoint(endpoint: RuntimeEndpoint): Promise<void> {
  try {
    if (endpoint.terminate) {
      await endpoint.terminate();
    } else {
      endpoint.close?.();
    }
  } catch {
    // Termination is best-effort; pending RPCs have already been rejected.
  }
}

async function invoke(client: SearchClient, request: RpcRequest): Promise<unknown> {
  if (request.method === "warmup") {
    const warmable = client as SearchClient & { warmup?: () => unknown };
    if (typeof warmable.warmup === "function") return warmable.warmup();

    // An empty query forces createSearch to fetch its manifest/corpora and load
    // the embedding engine, while its result is intentionally not transferred.
    await client.query("");
    return undefined;
  }

  const method = client[request.method] as unknown as (...args: unknown[]) => unknown;
  return method.apply(client, request.args);
}

/**
 * Expose a search client on a worker global, Web `MessagePort`, or Node
 * `worker_threads` endpoint. Passing an endpoint is only necessary in Node;
 * browser worker entries use their global scope by default.
 */
export function exposeSearch<Client extends SearchClient>(
  client: Client,
  target: WorkerMessageEndpoint = globalThis,
): () => void {
  const endpoint = endpointOf(target);

  const onMessage = (event: unknown): void => {
    const request = messageData(event);
    if (!isRpcRequest(request)) return;

    const postFailure = (error: unknown): void => {
      try {
        endpoint.postMessage({ id: request.id, error: serializeError(error) } satisfies RpcFailure);
      } catch {
        // If a plain error cannot be sent, the endpoint itself is no longer usable.
      }
    };

    void (async () => {
      try {
        const result = await invoke(client, request);
        const response: RpcSuccess = { id: request.id, result, loaded: [...client.loaded()] };
        try {
          endpoint.postMessage(response);
        } catch (error) {
          // DataCloneError is reported as a normal RPC failure instead of an
          // unhandled worker exception. The fallback payload is plain data.
          postFailure(error);
        }
      } catch (error) {
        postFailure(error);
      }
    })();
  };

  const removeMessageListener = listen(endpoint, "message", onMessage);
  endpoint.start?.();
  return removeMessageListener;
}

function startupError(error: unknown): Error {
  const original = error instanceof Error ? error : new Error(String(error));
  if (original.name === "ReferenceError" && /\bWorker\b.*\bnot defined\b/i.test(original.message)) {
    return new Error(
      "Seekite workerSearch cannot start because Worker is unavailable. " +
        "Create and use the worker client lazily in the browser rather than during SSR.",
      { cause: original },
    );
  }
  return original;
}

function terminatedError(): Error {
  const error = new Error("Seekite search worker has been terminated");
  error.name = "AbortError";
  return error;
}

/** Create a lazy, crash-resilient SearchClient proxy backed by a worker. */
export function workerSearch<Client extends SearchClient = SearchClient>(
  factory: WorkerFactory,
): WorkerSearchClient<Client> {
  let nextId = 1;
  let endpoint: RuntimeEndpoint | undefined;
  let spawning: Promise<RuntimeEndpoint> | undefined;
  let removeEndpointListeners: (() => void) | undefined;
  let destroyed = false;
  let loadedCorpora: string[] = [];
  const pending = new Map<number, PendingCall>();

  const rejectPending = (error: Error): void => {
    for (const call of pending.values()) call.reject(error);
    pending.clear();
  };

  const detach = (): void => {
    removeEndpointListeners?.();
    removeEndpointListeners = undefined;
  };

  const crash = (source: RuntimeEndpoint, error: Error): void => {
    if (destroyed || source !== endpoint) return;
    detach();
    endpoint = undefined;
    loadedCorpora = [];
    rejectPending(error);
    void stopEndpoint(source);
  };

  const install = (source: RuntimeEndpoint): void => {
    const removers = [
      listen(source, "message", (event) => {
        const response = messageData(event);
        if (!isRpcResponse(response)) return;
        const call = pending.get(response.id);
        if (!call) return;
        pending.delete(response.id);
        if ("error" in response) {
          call.reject(remoteError(response.error));
        } else {
          loadedCorpora = [...response.loaded];
          call.resolve(response.result);
        }
      }),
      listen(source, "error", (event) => {
        if (isRecord(event) && typeof event["preventDefault"] === "function") {
          (event["preventDefault"] as () => void)();
        }
        crash(source, eventError(event, "Seekite search worker crashed"));
      }),
      listen(source, "messageerror", (event) => {
        crash(source, eventError(event, "Seekite search worker could not deserialize a message"));
      }),
    ];
    if (source.on) {
      removers.push(
        listen(source, "exit", (code) => {
          const error = new Error(
            `Seekite search worker exited${typeof code === "number" ? ` with code ${code}` : ""}`,
          );
          error.name = "WorkerError";
          crash(source, error);
        }),
      );
    }
    removeEndpointListeners = () => {
      for (const remove of removers) remove();
    };
    source.start?.();
  };

  const ensureEndpoint = (): Promise<RuntimeEndpoint> => {
    if (destroyed) return Promise.reject(terminatedError());
    if (endpoint) return Promise.resolve(endpoint);
    if (spawning) return spawning;

    let tracked: Promise<RuntimeEndpoint>;
    tracked = Promise.resolve()
      .then(factory)
      .then(
        (created) => {
          const source = endpointOf(created);
          if (destroyed) {
            void stopEndpoint(source);
            throw terminatedError();
          }
          endpoint = source;
          try {
            install(source);
          } catch (error) {
            endpoint = undefined;
            detach();
            void stopEndpoint(source);
            throw error;
          }
          return source;
        },
        (error: unknown) => {
          throw startupError(error);
        },
      )
      .finally(() => {
        if (spawning === tracked) spawning = undefined;
      });
    spawning = tracked;
    return tracked;
  };

  const request = <Result>(method: RpcMethod, args: readonly unknown[]): Promise<Result> => {
    const id = nextId;
    nextId += 1;

    return new Promise<Result>((resolve, reject) => {
      pending.set(id, {
        resolve: (value) => resolve(value as Result),
        reject,
      });
      void ensureEndpoint().then(
        (source) => {
          // A termination or crash may have rejected this call while it waited
          // for an asynchronous factory. In that case, never send stale work.
          if (!pending.has(id)) return;
          try {
            source.postMessage({ id, method, args: [...args] } satisfies RpcRequest);
          } catch (error) {
            pending.delete(id);
            reject(eventError(error, "Unable to send a message to the Seekite search worker"));
          }
        },
        (error: unknown) => {
          if (!pending.delete(id)) return;
          reject(eventError(error, "Unable to start the Seekite search worker"));
        },
      );
    });
  };

  const terminate = async (): Promise<void> => {
    if (destroyed) return;
    destroyed = true;
    const source = endpoint;
    endpoint = undefined;
    detach();
    rejectPending(terminatedError());
    if (source) await stopEndpoint(source);
  };

  const proxy = {
    load: (...args: Parameters<Client["load"]>) => request("load", args),
    query: (...args: Parameters<Client["query"]>) => request("query", args),
    // SearchClient.loaded() is intentionally synchronous. Each response carries
    // the authoritative worker-side snapshot, so this remains a cheap local read.
    loaded: () => [...loadedCorpora],
    warmup: () => request<void>("warmup", []),
    terminate,
    destroy: terminate,
  };

  return proxy as unknown as WorkerSearchClient<Client>;
}
