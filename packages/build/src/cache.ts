import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  truncate,
  unlink,
  writeFile,
} from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";
import type { EmbeddingProvider } from "@seekite/core";

const CACHE_VERSION = 1 as const;
const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;
const LOCK_STALE_MS = 10 * 60 * 1_000;
const LOCK_TIMEOUT_MS = LOCK_STALE_MS;
const MASK_64 = (1n << 64n) - 1n;
const XXH_PRIME_1 = 11_400_714_785_074_694_791n;
const XXH_PRIME_2 = 14_029_467_366_897_019_727n;
const XXH_PRIME_3 = 1_609_587_929_392_839_161n;
const XXH_PRIME_4 = 9_650_029_242_287_828_579n;
const XXH_PRIME_5 = 2_870_177_450_012_600_261n;

type HashFunction = (input: string | Uint8Array, seed?: bigint) => bigint;

interface CacheIndex {
  version: typeof CACHE_VERSION;
  provider: string;
  dimensions: number;
  entries: Record<string, number>;
  accessed: Record<string, number>;
}

export type CacheWarningHandler = (message: string) => void;

export interface CacheLocationOptions {
  /** Project root. Defaults to the current working directory. */
  root?: string;
  /** Cache root. Defaults to SEEKITE_CACHE_DIR or `<root>/.seekite/cache`. */
  cacheDir?: string;
}

export interface CachedEmbeddingOptions extends CacheLocationOptions {
  /** Read existing rows. False still embeds and appends rows to warm the cache. */
  read?: boolean;
  onWarning?: CacheWarningHandler;
}

export interface CachedEmbeddingResult {
  vectors: Float32Array[];
  cached: number;
  embedded: number;
}

export interface EmbeddingCacheProviderStats {
  provider: string;
  dimensions: number;
  entries: number;
  bytes: number;
  lastUsed: string | null;
}

export interface EmbeddingCacheStats extends CacheLocationOptions {
  directory: string;
  providers: EmbeddingCacheProviderStats[];
  entries: number;
  bytes: number;
}

export interface PruneEmbeddingCacheOptions extends CacheLocationOptions {
  maxSize?: number;
  onWarning?: CacheWarningHandler;
}

export interface PruneEmbeddingCacheResult {
  directory: string;
  providers: number;
  entriesRemoved: number;
  bytesBefore: number;
  bytesAfter: number;
}

export interface ClearEmbeddingCacheOptions extends CacheLocationOptions {
  provider?: string;
}

export interface ClearEmbeddingCacheResult {
  directory: string;
  providersRemoved: number;
  bytesRemoved: number;
}

interface ProviderCachePaths {
  root: string;
  embeddings: string;
  directoryName: string;
  provider: string;
  index: string;
  vectors: string;
  lock: string;
}

interface LoadedProvider {
  paths: ProviderCachePaths;
  index: CacheIndex;
  vectorBytes: number;
  indexMtimeMs: number;
}

interface CompactionResult {
  provider: string;
  directoryName: string;
  dimensions: number;
  entries: Array<{ key: string; accessed: number }>;
  entriesRemoved: number;
  bytesBefore: number;
  bytesAfter: number;
}

function add64(left: bigint, right: bigint): bigint {
  return (left + right) & MASK_64;
}

function multiply64(left: bigint, right: bigint): bigint {
  return (left * right) & MASK_64;
}

function rotateLeft64(value: bigint, bits: bigint): bigint {
  return ((value << bits) | (value >> (64n - bits))) & MASK_64;
}

function xxhRound(accumulator: bigint, input: bigint): bigint {
  return multiply64(
    rotateLeft64(add64(accumulator, multiply64(input, XXH_PRIME_2)), 31n),
    XXH_PRIME_1,
  );
}

function xxhMergeRound(accumulator: bigint, value: bigint): bigint {
  return add64(multiply64(accumulator ^ xxhRound(0n, value), XXH_PRIME_1), XXH_PRIME_4);
}

/** Pure-JavaScript XXH64 used when the optional native package is unavailable. */
export function xxhash64Fallback(input: string | Uint8Array, seed = 0n): bigint {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = bytes.byteLength;
  let offset = 0;
  let hash: bigint;

  if (length >= 32) {
    let lane1 = add64(add64(seed, XXH_PRIME_1), XXH_PRIME_2);
    let lane2 = add64(seed, XXH_PRIME_2);
    let lane3 = seed & MASK_64;
    let lane4 = (seed - XXH_PRIME_1) & MASK_64;
    const limit = length - 32;
    do {
      lane1 = xxhRound(lane1, view.getBigUint64(offset, true));
      lane2 = xxhRound(lane2, view.getBigUint64(offset + 8, true));
      lane3 = xxhRound(lane3, view.getBigUint64(offset + 16, true));
      lane4 = xxhRound(lane4, view.getBigUint64(offset + 24, true));
      offset += 32;
    } while (offset <= limit);
    hash = add64(
      add64(rotateLeft64(lane1, 1n), rotateLeft64(lane2, 7n)),
      add64(rotateLeft64(lane3, 12n), rotateLeft64(lane4, 18n)),
    );
    hash = xxhMergeRound(hash, lane1);
    hash = xxhMergeRound(hash, lane2);
    hash = xxhMergeRound(hash, lane3);
    hash = xxhMergeRound(hash, lane4);
  } else {
    hash = add64(seed, XXH_PRIME_5);
  }

  hash = add64(hash, BigInt(length));
  while (length - offset >= 8) {
    hash = add64(
      multiply64(
        rotateLeft64(hash ^ xxhRound(0n, view.getBigUint64(offset, true)), 27n),
        XXH_PRIME_1,
      ),
      XXH_PRIME_4,
    );
    offset += 8;
  }
  if (length - offset >= 4) {
    hash = add64(
      multiply64(
        rotateLeft64(hash ^ multiply64(BigInt(view.getUint32(offset, true)), XXH_PRIME_1), 23n),
        XXH_PRIME_2,
      ),
      XXH_PRIME_3,
    );
    offset += 4;
  }
  while (length - offset > 0) {
    hash = multiply64(
      rotateLeft64(hash ^ multiply64(BigInt(view.getUint8(offset)), XXH_PRIME_5), 11n),
      XXH_PRIME_1,
    );
    offset += 1;
  }

  hash = multiply64(hash ^ (hash >> 33n), XXH_PRIME_2);
  hash = multiply64(hash ^ (hash >> 29n), XXH_PRIME_3);
  return (hash ^ (hash >> 32n)) & MASK_64;
}

let selectedHashFunction: Promise<HashFunction> | undefined;

async function selectHashFunction(): Promise<HashFunction> {
  selectedHashFunction ??= import("@seekite/engine-native")
    .then((native): HashFunction =>
      native.isSupported()
        ? (input, seed) => {
            try {
              return native.xxhash64(input, seed);
            } catch {
              return xxhash64Fallback(input, seed);
            }
          }
        : xxhash64Fallback,
    )
    .catch(() => xxhash64Fallback);
  return selectedHashFunction;
}

function hashHex(hash: bigint): string {
  return BigInt.asUintN(64, hash).toString(16).padStart(16, "0");
}

/** Content-addressed cache key for one exact provider/text pair. */
export async function embeddingCacheKey(providerId: string, text: string): Promise<string> {
  const hash = await selectHashFunction();
  return hashHex(hash(`${providerId}\0${text}`));
}

/** Collision-free, filesystem-safe encoding of a provider id. */
export function sanitizeProviderId(providerId: string): string {
  if (providerId.length === 0) throw new Error("Embedding provider id must not be empty");
  const bytes = new TextEncoder().encode(providerId);
  let output = "";
  for (const byte of bytes) {
    const safe =
      (byte >= 48 && byte <= 57) ||
      (byte >= 65 && byte <= 90) ||
      (byte >= 97 && byte <= 122) ||
      byte === 45 ||
      byte === 46 ||
      byte === 95;
    output += safe ? String.fromCharCode(byte) : `~${byte.toString(16).padStart(2, "0")}`;
  }
  return output === "." || output === ".."
    ? [...bytes].map((byte) => `~${byte.toString(16).padStart(2, "0")}`).join("")
    : output;
}

/** Resolve the cache root shared by builds and cache-management commands. */
export function resolveEmbeddingCacheDirectory(options: CacheLocationOptions = {}): string {
  const root = path.resolve(options.root ?? process.cwd());
  const configured =
    options.cacheDir ?? process.env["SEEKITE_CACHE_DIR"] ?? path.join(".seekite", "cache");
  return path.resolve(root, configured);
}

function providerPaths(provider: string, options: CacheLocationOptions = {}): ProviderCachePaths {
  const root = resolveEmbeddingCacheDirectory(options);
  const embeddings = path.join(root, "embeddings");
  const directoryName = sanitizeProviderId(provider);
  const providerDirectory = path.join(embeddings, directoryName);
  return {
    root,
    embeddings,
    directoryName,
    provider: providerDirectory,
    index: path.join(providerDirectory, "index.json"),
    vectors: path.join(providerDirectory, "vectors.bin"),
    lock: path.join(root, ".locks", `${directoryName}.lock`),
  };
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

async function fileStat(file: string): Promise<Stats | undefined> {
  return stat(file).catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  });
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireLock(paths: ProviderCachePaths): Promise<() => Promise<void>> {
  await mkdir(path.dirname(paths.lock), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    let created = false;
    try {
      const handle = await open(paths.lock, "wx");
      created = true;
      try {
        await handle.writeFile(
          `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
        );
      } catch (error) {
        await unlink(paths.lock).catch(() => undefined);
        throw error;
      } finally {
        await handle.close();
      }
      return async () => {
        await unlink(paths.lock).catch((error: unknown) => {
          if (!isNodeError(error, "ENOENT")) throw error;
        });
      };
    } catch (error) {
      if (created) {
        await unlink(paths.lock).catch(() => undefined);
        throw error;
      }
      if (!isNodeError(error, "EEXIST")) throw error;
      const information = await fileStat(paths.lock);
      if (!information || Date.now() - information.mtimeMs > LOCK_STALE_MS) {
        await unlink(paths.lock).catch((unlinkError: unknown) => {
          if (!isNodeError(unlinkError, "ENOENT")) throw unlinkError;
        });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for embedding cache lock ${paths.lock}`, {
          cause: error,
        });
      }
      await delay(25);
    }
  }
}

function emptyIndex(provider: string, dimensions: number): CacheIndex {
  return { version: CACHE_VERSION, provider, dimensions, entries: {}, accessed: {} };
}

function parseIndex(value: unknown, fallbackProvider: string): CacheIndex | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<CacheIndex>;
  const dimensions = candidate.dimensions;
  if (
    candidate.version !== CACHE_VERSION ||
    (candidate.provider !== undefined && typeof candidate.provider !== "string") ||
    typeof dimensions !== "number" ||
    !Number.isSafeInteger(dimensions) ||
    dimensions <= 0 ||
    !candidate.entries ||
    typeof candidate.entries !== "object" ||
    Array.isArray(candidate.entries)
  )
    return undefined;

  const entries: Record<string, number> = {};
  for (const [key, row] of Object.entries(candidate.entries)) {
    if (!/^[0-9a-f]{16}$/.test(key) || !Number.isSafeInteger(row) || row < 0) return undefined;
    entries[key] = row;
  }
  const accessed: Record<string, number> = {};
  if (
    candidate.accessed &&
    typeof candidate.accessed === "object" &&
    !Array.isArray(candidate.accessed)
  ) {
    for (const [key, timestamp] of Object.entries(candidate.accessed)) {
      if (
        key in entries &&
        typeof timestamp === "number" &&
        Number.isFinite(timestamp) &&
        timestamp >= 0
      )
        accessed[key] = timestamp;
    }
  }
  return {
    version: CACHE_VERSION,
    provider: candidate.provider ?? fallbackProvider,
    dimensions,
    entries,
    accessed,
  };
}

async function readIndex(
  paths: ProviderCachePaths,
  fallbackProvider = paths.directoryName,
): Promise<{ index?: CacheIndex; mtimeMs: number; corrupt: boolean }> {
  const information = await fileStat(paths.index);
  if (!information) return { mtimeMs: 0, corrupt: false };
  try {
    const index = parseIndex(JSON.parse(await readFile(paths.index, "utf8")), fallbackProvider);
    return index
      ? { index, mtimeMs: information.mtimeMs, corrupt: false }
      : { mtimeMs: information.mtimeMs, corrupt: true };
  } catch {
    return { mtimeMs: information.mtimeMs, corrupt: true };
  }
}

async function writeIndex(paths: ProviderCachePaths, index: CacheIndex): Promise<void> {
  const entries = Object.fromEntries(
    Object.entries(index.entries).sort(([left], [right]) => left.localeCompare(right)),
  );
  const accessed = Object.fromEntries(
    Object.entries(index.accessed)
      .filter(([key]) => key in entries)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const temporary = `${paths.index}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ ...index, entries, accessed })}\n`, {
    flag: "wx",
  });
  await rename(temporary, paths.index).catch(async (error: unknown) => {
    await unlink(temporary).catch(() => undefined);
    throw error;
  });
}

function decodeRow(buffer: Uint8Array, dimensions: number): Float32Array {
  const values = new Float32Array(dimensions);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  for (let index = 0; index < dimensions; index += 1)
    values[index] = view.getFloat32(index * FLOAT_BYTES, true);
  return values;
}

function encodeRow(vector: Float32Array, dimensions: number): Uint8Array {
  if (vector.length !== dimensions) {
    throw new Error(`Expected ${dimensions} embedding dimensions, received ${vector.length}`);
  }
  const bytes = new Uint8Array(dimensions * FLOAT_BYTES);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < dimensions; index += 1)
    view.setFloat32(index * FLOAT_BYTES, vector[index] ?? 0, true);
  return bytes;
}

async function loadProvider(
  paths: ProviderCachePaths,
  expectedProvider: string,
  expectedDimensions: number,
  warn: CacheWarningHandler,
): Promise<LoadedProvider> {
  await mkdir(paths.provider, { recursive: true });
  let loaded = await readIndex(paths, expectedProvider);
  if (
    loaded.index &&
    (loaded.index.dimensions !== expectedDimensions || loaded.index.provider !== expectedProvider)
  ) {
    warn(
      `Embedding cache for ${expectedProvider} has a provider or dimension mismatch; discarding ${paths.provider}`,
    );
    await rm(paths.provider, { recursive: true, force: true });
    await mkdir(paths.provider, { recursive: true });
    loaded = { mtimeMs: 0, corrupt: false };
  } else if (loaded.corrupt) {
    warn(`Embedding cache index is corrupt at ${paths.index}; treating it as empty`);
  }

  const index = loaded.index ?? emptyIndex(expectedProvider, expectedDimensions);
  const vectorInformation = await fileStat(paths.vectors);
  const rowBytes = expectedDimensions * FLOAT_BYTES;
  let vectorBytes = vectorInformation?.size ?? 0;
  if (vectorBytes % rowBytes !== 0) {
    const completeBytes = vectorBytes - (vectorBytes % rowBytes);
    warn(
      `Embedding cache vectors have an incomplete row at ${paths.vectors}; truncating the partial tail`,
    );
    await truncate(paths.vectors, completeBytes);
    vectorBytes = completeBytes;
  }
  const rows = vectorBytes / rowBytes;
  let invalidEntries = 0;
  for (const [key, row] of Object.entries(index.entries)) {
    if (row >= rows) {
      delete index.entries[key];
      delete index.accessed[key];
      invalidEntries += 1;
    }
  }
  if (invalidEntries > 0)
    warn(
      `Embedding cache index at ${paths.index} referenced ${invalidEntries} missing row${invalidEntries === 1 ? "" : "s"}; re-embedding them`,
    );
  return { paths, index, vectorBytes, indexMtimeMs: loaded.mtimeMs };
}

/**
 * Resolve vectors through the append-only provider cache while preserving the
 * input order. All unique misses are sent in one provider batch.
 */
export async function embedDocumentsCached(
  provider: EmbeddingProvider,
  texts: string[],
  options: CachedEmbeddingOptions = {},
): Promise<CachedEmbeddingResult> {
  if (!Number.isSafeInteger(provider.dimensions) || provider.dimensions <= 0) {
    throw new Error(
      `Embedding provider ${provider.id} has invalid dimensions ${provider.dimensions}`,
    );
  }
  if (texts.length === 0) return { vectors: [], cached: 0, embedded: 0 };

  const paths = providerPaths(provider.id, options);
  const release = await acquireLock(paths);
  const warn = options.onWarning ?? console.warn;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const loaded = await loadProvider(paths, provider.id, provider.dimensions, warn);
    const hasher = await selectHashFunction();
    const keys = texts.map((text) => hashHex(hasher(`${provider.id}\0${text}`)));
    const rowBytes = provider.dimensions * FLOAT_BYTES;
    handle = await open(paths.vectors, "a+");
    let nextRow = loaded.vectorBytes / rowBytes;
    const vectorsByKey = new Map<string, Float32Array>();
    let cached = 0;

    if (options.read !== false) {
      for (const key of new Set(keys)) {
        const row = loaded.index.entries[key];
        if (row === undefined) continue;
        const buffer = new Uint8Array(rowBytes);
        const read = await handle.read(buffer, 0, rowBytes, row * rowBytes);
        if (read.bytesRead !== rowBytes) {
          delete loaded.index.entries[key];
          delete loaded.index.accessed[key];
          continue;
        }
        vectorsByKey.set(key, decodeRow(buffer, provider.dimensions));
      }
      cached = keys.reduce((count, key) => count + (vectorsByKey.has(key) ? 1 : 0), 0);
    }

    const missKeys: string[] = [];
    const missTexts: string[] = [];
    const seenMisses = new Set<string>();
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (key === undefined || vectorsByKey.has(key) || seenMisses.has(key)) continue;
      seenMisses.add(key);
      missKeys.push(key);
      missTexts.push(texts[index] ?? "");
    }

    if (missTexts.length > 0) {
      const embedded = await provider.embedDocuments(missTexts);
      if (embedded.length !== missTexts.length) {
        throw new Error(
          `Embedding provider ${provider.id} returned ${embedded.length} vectors for ${missTexts.length} texts`,
        );
      }
      for (let index = 0; index < embedded.length; index += 1) {
        const vector = embedded[index];
        const key = missKeys[index];
        if (!vector || key === undefined)
          throw new Error(`Embedding provider ${provider.id} omitted vector ${index}`);
        const bytes = encodeRow(vector, provider.dimensions);
        await handle.write(bytes);
        loaded.index.entries[key] = nextRow;
        nextRow += 1;
        vectorsByKey.set(key, vector);
      }
    }

    const accessedAt = Date.now();
    for (const key of new Set(keys)) loaded.index.accessed[key] = accessedAt;
    await handle.sync();
    await writeIndex(paths, loaded.index);
    const vectors = keys.map((key) => {
      const vector = vectorsByKey.get(key);
      if (!vector) throw new Error(`Embedding cache failed to resolve key ${key}`);
      return vector;
    });
    return { vectors, cached, embedded: missTexts.length };
  } finally {
    try {
      await handle?.close();
    } finally {
      await release();
    }
  }
}

async function providerDirectories(cacheRoot: string): Promise<string[]> {
  const embeddings = path.join(cacheRoot, "embeddings");
  const entries = await readdir(embeddings, { withFileTypes: true }).catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) return [];
    throw error;
  });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function pathsFromDirectory(cacheRoot: string, directoryName: string): ProviderCachePaths {
  const embeddings = path.join(cacheRoot, "embeddings");
  const provider = path.join(embeddings, directoryName);
  return {
    root: cacheRoot,
    embeddings,
    directoryName,
    provider,
    index: path.join(provider, "index.json"),
    vectors: path.join(provider, "vectors.bin"),
    lock: path.join(cacheRoot, ".locks", `${directoryName}.lock`),
  };
}

/** Inspect the embedding cache without modifying it. */
export async function getEmbeddingCacheStats(
  options: CacheLocationOptions = {},
): Promise<EmbeddingCacheStats> {
  const directory = resolveEmbeddingCacheDirectory(options);
  const providers: EmbeddingCacheProviderStats[] = [];
  for (const directoryName of await providerDirectories(directory)) {
    const paths = pathsFromDirectory(directory, directoryName);
    const loaded = await readIndex(paths);
    const vectorInformation = await fileStat(paths.vectors);
    if (!loaded.index && !vectorInformation) continue;
    const bytes = vectorInformation?.size ?? 0;
    const dimensions = loaded.index?.dimensions ?? 0;
    const validRows = dimensions > 0 ? Math.floor(bytes / (dimensions * FLOAT_BYTES)) : 0;
    const validKeys = loaded.index
      ? Object.keys(loaded.index.entries).filter(
          (key) => (loaded.index?.entries[key] ?? Number.POSITIVE_INFINITY) < validRows,
        )
      : [];
    const timestamps = loaded.index
      ? validKeys.map((key) => loaded.index?.accessed[key] ?? loaded.mtimeMs)
      : [loaded.mtimeMs];
    const lastUsedMs = timestamps.length > 0 ? Math.max(...timestamps) : loaded.mtimeMs;
    providers.push({
      provider: loaded.index?.provider ?? directoryName,
      dimensions,
      entries: validKeys.length,
      bytes,
      lastUsed: lastUsedMs > 0 ? new Date(lastUsedMs).toISOString() : null,
    });
  }
  return {
    ...options,
    directory,
    providers,
    entries: providers.reduce((total, provider) => total + provider.entries, 0),
    bytes: providers.reduce((total, provider) => total + provider.bytes, 0),
  };
}

async function replaceVectors(paths: ProviderCachePaths, bytes: Uint8Array): Promise<void> {
  await mkdir(paths.provider, { recursive: true });
  const temporary = `${paths.vectors}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, paths.vectors).catch(async (error: unknown) => {
    await unlink(temporary).catch(() => undefined);
    throw error;
  });
}

async function compactProvider(
  paths: ProviderCachePaths,
  removeKeys: ReadonlySet<string>,
  warn: CacheWarningHandler,
): Promise<CompactionResult | undefined> {
  const release = await acquireLock(paths);
  try {
    const loaded = await readIndex(paths);
    const vectorInformation = await fileStat(paths.vectors);
    const bytesBefore = vectorInformation?.size ?? 0;
    if (!loaded.index) {
      if (loaded.corrupt)
        warn(`Embedding cache index is corrupt at ${paths.index}; pruning the provider directory`);
      if (bytesBefore === 0 && !loaded.corrupt) return undefined;
      await rm(paths.provider, { recursive: true, force: true });
      return {
        provider: paths.directoryName,
        directoryName: paths.directoryName,
        dimensions: 0,
        entries: [],
        entriesRemoved: 0,
        bytesBefore,
        bytesAfter: 0,
      };
    }

    const rowBytes = loaded.index.dimensions * FLOAT_BYTES;
    const source = await readFile(paths.vectors).catch((error: unknown) => {
      if (isNodeError(error, "ENOENT")) return Buffer.alloc(0);
      throw error;
    });
    const sourceRows = Math.floor(source.byteLength / rowBytes);
    const selected = Object.entries(loaded.index.entries)
      .filter(([key, row]) => !removeKeys.has(key) && row < sourceRows)
      .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]));
    const entries: Record<string, number> = {};
    const accessed: Record<string, number> = {};
    const rowMap = new Map<number, number>();
    const outputRows: Uint8Array[] = [];
    for (const [key, oldRow] of selected) {
      let newRow = rowMap.get(oldRow);
      if (newRow === undefined) {
        newRow = outputRows.length;
        rowMap.set(oldRow, newRow);
        outputRows.push(source.subarray(oldRow * rowBytes, (oldRow + 1) * rowBytes));
      }
      entries[key] = newRow;
      accessed[key] = loaded.index.accessed[key] ?? loaded.mtimeMs;
    }
    const output = Buffer.concat(
      outputRows.map((row) => Buffer.from(row.buffer, row.byteOffset, row.byteLength)),
    );
    await replaceVectors(paths, output);
    await writeIndex(paths, { ...loaded.index, entries, accessed });
    return {
      provider: loaded.index.provider,
      directoryName: paths.directoryName,
      dimensions: loaded.index.dimensions,
      entries: Object.keys(entries).map((key) => ({
        key,
        accessed: accessed[key] ?? loaded.mtimeMs,
      })),
      entriesRemoved: Object.keys(loaded.index.entries).length - Object.keys(entries).length,
      bytesBefore,
      bytesAfter: output.byteLength,
    };
  } finally {
    await release();
  }
}

/** Remove orphan/corrupt rows and optionally evict the oldest entries to a byte budget. */
export async function pruneEmbeddingCache(
  options: PruneEmbeddingCacheOptions = {},
): Promise<PruneEmbeddingCacheResult> {
  if (
    options.maxSize !== undefined &&
    (!Number.isSafeInteger(options.maxSize) || options.maxSize < 0)
  ) {
    throw new Error(`Cache max size must be a non-negative integer, received ${options.maxSize}`);
  }
  const directory = resolveEmbeddingCacheDirectory(options);
  const warn = options.onWarning ?? console.warn;
  const compacted: CompactionResult[] = [];
  let bytesBefore = 0;
  let entriesRemoved = 0;
  for (const directoryName of await providerDirectories(directory)) {
    const result = await compactProvider(
      pathsFromDirectory(directory, directoryName),
      new Set(),
      warn,
    );
    if (!result) continue;
    compacted.push(result);
    bytesBefore += result.bytesBefore;
    entriesRemoved += result.entriesRemoved;
  }

  let bytesAfter = compacted.reduce((total, provider) => total + provider.bytesAfter, 0);
  if (options.maxSize !== undefined && bytesAfter > options.maxSize) {
    const candidates = compacted
      .flatMap((provider) =>
        provider.entries.map((entry) => ({
          ...entry,
          directoryName: provider.directoryName,
          rowBytes: provider.dimensions * FLOAT_BYTES,
        })),
      )
      .sort(
        (left, right) =>
          left.accessed - right.accessed ||
          left.directoryName.localeCompare(right.directoryName) ||
          left.key.localeCompare(right.key),
      );
    const removals = new Map<string, Set<string>>();
    let projectedBytes = bytesAfter;
    for (const candidate of candidates) {
      if (projectedBytes <= options.maxSize) break;
      const keys = removals.get(candidate.directoryName) ?? new Set<string>();
      keys.add(candidate.key);
      removals.set(candidate.directoryName, keys);
      projectedBytes = Math.max(0, projectedBytes - candidate.rowBytes);
    }
    for (const [directoryName, keys] of removals) {
      const result = await compactProvider(
        pathsFromDirectory(directory, directoryName),
        keys,
        warn,
      );
      if (result) entriesRemoved += result.entriesRemoved;
    }
    bytesAfter = (await getEmbeddingCacheStats({ cacheDir: directory })).bytes;
  }

  return { directory, providers: compacted.length, entriesRemoved, bytesBefore, bytesAfter };
}

/** Clear one provider or every provider from the embedding cache. */
export async function clearEmbeddingCache(
  options: ClearEmbeddingCacheOptions = {},
): Promise<ClearEmbeddingCacheResult> {
  const directory = resolveEmbeddingCacheDirectory(options);
  const directoryNames = options.provider
    ? [sanitizeProviderId(options.provider)]
    : await providerDirectories(directory);
  let providersRemoved = 0;
  let bytesRemoved = 0;
  for (const directoryName of directoryNames) {
    const paths = pathsFromDirectory(directory, directoryName);
    const information = await fileStat(paths.provider);
    if (!information?.isDirectory()) continue;
    const release = await acquireLock(paths);
    try {
      const vectorInformation = await fileStat(paths.vectors);
      bytesRemoved += vectorInformation?.size ?? 0;
      await rm(paths.provider, { recursive: true, force: true });
      providersRemoved += 1;
    } finally {
      await release();
    }
  }
  return { directory, providersRemoved, bytesRemoved };
}
