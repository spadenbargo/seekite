import {
  SeekiteFormatError,
  decodeDictionaryV2,
  decodeLexicalIndex,
  decodePostingsV2,
  decodeVectors,
  decodeVectorsV2,
  vectorSimilarity,
  type DecodedVectorsV2,
} from "./codec.js";
import {
  expandQueryTerms,
  fold,
  stemEnglish,
  tokenizeWithOffsets,
  type AnalyzerOptions,
} from "./analyzer.js";
import { scoreLexicalV2, searchLexical, tokenize } from "./lexical.js";
import type {
  ContentShardV2,
  CorpusManifest,
  CorpusManifestV1,
  CorpusManifestV2,
  CorpusMetadataV1,
  CorpusMetadataV2,
  CustomAnalyzer,
  EmbeddingProvider,
  FilterPredicate,
  FilterScalar,
  LexicalDictionaryV2,
  LexicalIndex,
  MatchedTerm,
  QueryOptions,
  QueryResponse,
  SearchChunk,
  SearchManifest,
  SearchResult,
  WhereClause,
} from "./types.js";

interface CreateSearchCommonOptions {
  /** One provider, a list, or providers keyed by their stable IDs. */
  embeddings?: EmbeddingProvider | EmbeddingProvider[] | Record<string, EmbeddingProvider>;
  /** @deprecated Use `embeddings`. */
  embeddingProviders?: Record<string, EmbeddingProvider>;
  /** Custom lexical stemmers keyed by their manifest id, with or without `custom:`. */
  analyzers?: Record<string, CustomAnalyzer>;
  fetch?: typeof globalThis.fetch;
}

export type CreateSearchOptions = CreateSearchCommonOptions &
  (
    | {
        /** Asset key below the application's build base. Defaults to `search`. */
        key?: string;
        url?: never;
      }
    | {
        /** Explicit search asset URL, useful for a CDN or separately hosted index. */
        url: string;
        key?: never;
      }
  );

interface LoadedCorpusV1 {
  version: 1;
  root: string;
  definition: CorpusManifestV1;
  metadata: CorpusMetadataV1;
  lexical: LexicalIndex;
  vectors?: Float32Array[];
  runtimeVectors?: Promise<Float32Array[]>;
}

interface LoadedCorpusV2 {
  version: 2;
  root: string;
  definition: CorpusManifestV2;
  metadata: CorpusMetadataV2;
  lexical: LexicalDictionaryV2;
  vectors?: DecodedVectorsV2 | Float32Array[];
  runtimeVectors?: Promise<Float32Array[]>;
  postings: LruPromises<ArrayBuffer>;
  content: LruPromises<ContentShardV2>;
  chunkById: Map<string, number>;
}

type LoadedCorpus = LoadedCorpusV1 | LoadedCorpusV2;

export interface SearchClient {
  load(corpus: string): Promise<void>;
  query(query: string, options?: QueryOptions): Promise<QueryResponse>;
  loaded(): string[];
  warmup?(): Promise<void>;
}

class LruPromises<Value> {
  readonly #values = new Map<number, Promise<Value>>();

  constructor(private readonly maximum: number) {}

  get(key: number, load: () => Promise<Value>): Promise<Value> {
    const existing = this.#values.get(key);
    if (existing) {
      this.#values.delete(key);
      this.#values.set(key, existing);
      return existing;
    }
    const pending = load().catch((error) => {
      this.#values.delete(key);
      throw error;
    });
    this.#values.set(key, pending);
    while (this.#values.size > this.maximum) this.#values.delete(this.#values.keys().next().value!);
    return pending;
  }
}

function joinURL(...parts: string[]): string {
  return parts
    .map((part, index) => (index === 0 ? part.replace(/\/$/, "") : part.replace(/^\//, "")))
    .join("/");
}

export function resolveIndexURL(options: CreateSearchOptions): string {
  if (options.url !== undefined) {
    const url = options.url.trim();
    if (!url) throw new Error("Seekite url cannot be empty");
    if (
      (!url.startsWith("/") && !/^[a-z][a-z\d+.-]*:\/\//i.test(url)) ||
      url.includes("?") ||
      url.includes("#")
    ) {
      throw new Error(
        "Seekite url must be absolute or root-relative without a query or hash; use key for build-relative assets",
      );
    }
    return url.replace(/\/$/, "");
  }

  const key = options.key ?? "search";
  const segments = key.split("/");
  if (
    !key ||
    key.startsWith("/") ||
    key.includes("?") ||
    key.includes("#") ||
    /^[a-z][a-z\d+.-]*:/i.test(key) ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error("Seekite key must be a non-empty relative asset path such as `search`");
  }

  const viteBase = (import.meta as ImportMeta & { readonly env?: { readonly BASE_URL?: string } })
    .env?.BASE_URL;
  if (viteBase) return joinURL(viteBase, key);
  const document_ = (globalThis as typeof globalThis & { document?: Document }).document;
  const baseElement = document_?.querySelector<HTMLBaseElement>("base[href]");
  if (baseElement) return new URL(key, baseElement.href).toString().replace(/\/$/, "");
  return joinURL("/", key);
}

function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    dot += l * r;
    leftMagnitude += l * l;
    rightMagnitude += r * r;
  }
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude) || 1);
}

export function embeddingText(chunk: SearchChunk): string {
  return `${chunk.title}\n${chunk.heading ?? ""}\n${chunk.content}`;
}

function providerMap(options: CreateSearchOptions): Record<string, EmbeddingProvider> {
  const configured = options.embeddings;
  if (!configured) return options.embeddingProviders ?? {};
  const values = Array.isArray(configured)
    ? configured
    : "id" in configured
      ? [configured]
      : Object.values(configured);
  return Object.fromEntries(values.map((provider) => [provider.id, provider]));
}

function validateVector(provider: EmbeddingProvider, vector: Float32Array, expected: number): void {
  if (provider.dimensions !== expected) {
    throw new Error(
      `Embedding provider ${provider.id} declares ${provider.dimensions} dimensions; expected ${expected}`,
    );
  }
  if (vector.length !== expected) {
    throw new Error(
      `Embedding provider ${provider.id} returned ${vector.length} dimensions; expected ${expected}`,
    );
  }
}

async function fetchJSON<Value>(fetcher: typeof fetch, url: string): Promise<Value> {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`Unable to load Seekite asset ${url}: ${response.status}`);
  return response.json() as Promise<Value>;
}

async function fetchBuffer(fetcher: typeof fetch, url: string): Promise<ArrayBuffer> {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`Unable to load Seekite asset ${url}: ${response.status}`);
  return response.arrayBuffer();
}

function isV2(definition: CorpusManifest): definition is CorpusManifestV2 {
  return definition.format === 2;
}

function analyzerFor(
  definition: CorpusManifestV2,
  configured: Record<string, CustomAnalyzer> | undefined,
): AnalyzerOptions {
  const stemmer = definition.analyzer.stemmer;
  let custom: CustomAnalyzer | undefined;
  if (stemmer?.startsWith("custom:"))
    custom = configured?.[stemmer] ?? configured?.[stemmer.slice("custom:".length)];
  return { ...definition.analyzer, custom };
}

function chunkV2(corpus: LoadedCorpusV2, index: number): SearchChunk {
  const columns = corpus.metadata.chunks;
  const metadata: Record<string, unknown> = {};
  for (const [field, values] of Object.entries(columns.filters)) metadata[field] = values[index];
  return {
    id: columns.id[index] ?? String(index),
    documentId: corpus.metadata.documents[columns.document[index] ?? 0] ?? String(index),
    url: columns.url[index] ?? "",
    title: columns.title[index] ?? "",
    heading: columns.heading[index] || undefined,
    content: "",
    metadata,
  };
}

function contentURL(corpus: LoadedCorpusV2, shard: number): string {
  return joinURL(
    corpus.root,
    `${corpus.definition.content.prefix}${String(shard).padStart(3, "0")}.json`,
  );
}

async function hydrateChunk(
  corpus: LoadedCorpusV2,
  index: number,
  fetcher: typeof fetch,
): Promise<SearchChunk> {
  const base = chunkV2(corpus, index);
  const location = corpus.metadata.chunks.content[index];
  if (!location) return base;
  const shard = await corpus.content.get(location[0], async () => {
    const value = await fetchJSON<ContentShardV2>(fetcher, contentURL(corpus, location[0]));
    if (value.version !== 2 || !Array.isArray(value.chunks))
      throw new SeekiteFormatError("Invalid Seekite content shard");
    return value;
  });
  const content = shard.chunks[location[1]];
  if (!content)
    throw new SeekiteFormatError(`Seekite content shard does not contain chunk ${location[1]}`);
  return { ...base, content: content.content, metadata: { ...base.metadata, ...content.metadata } };
}

async function hydrateAll(corpus: LoadedCorpusV2, fetcher: typeof fetch): Promise<SearchChunk[]> {
  return Promise.all(
    corpus.metadata.chunks.id.map((_id, index) => hydrateChunk(corpus, index, fetcher)),
  );
}

async function corpusVectors(
  name: string,
  corpus: LoadedCorpus,
  providers: Record<string, EmbeddingProvider>,
  fetcher: typeof fetch,
): Promise<DecodedVectorsV2 | Float32Array[] | undefined> {
  if (corpus.vectors) return corpus.vectors;
  const embedding = corpus.definition.embedding;
  if (!embedding || embedding.mode !== "runtime") return undefined;
  const provider = providers[embedding.provider];
  if (!provider) return undefined;
  corpus.runtimeVectors ??= (async () => {
    const chunks =
      corpus.version === 1 ? corpus.metadata.chunks : await hydrateAll(corpus, fetcher);
    const vectors = await provider.embedDocuments(chunks.map(embeddingText));
    if (vectors.length !== chunks.length) {
      throw new Error(
        `Embedding provider ${provider.id} returned ${vectors.length} vectors for ${chunks.length} chunks in ${name}`,
      );
    }
    vectors.forEach((vector) => validateVector(provider, vector, embedding.dimensions));
    corpus.vectors = vectors;
    return vectors;
  })();
  return corpus.runtimeVectors;
}

function similarity(
  vectors: DecodedVectorsV2 | Float32Array[],
  index: number,
  query: Float32Array,
): number | undefined {
  if (Array.isArray(vectors)) {
    const row = vectors[index];
    return row ? cosineSimilarity(query, row) : undefined;
  }
  return index < vectors.count ? vectorSimilarity(vectors, index, query) : undefined;
}

function scalarMatches(actual: unknown, expected: FilterScalar): boolean {
  return Array.isArray(actual)
    ? actual.some((value) => Object.is(value, expected))
    : Object.is(actual, expected);
}

function predicateMatches(actual: unknown, predicate: FilterPredicate): boolean {
  const exists = actual !== undefined && actual !== null;
  if (predicate.exists !== undefined && exists !== predicate.exists) return false;
  if (predicate.in && !predicate.in.some((expected) => scalarMatches(actual, expected)))
    return false;
  const numeric = typeof actual === "number" ? actual : undefined;
  if (predicate.gte !== undefined && (numeric === undefined || numeric < predicate.gte))
    return false;
  if (predicate.gt !== undefined && (numeric === undefined || numeric <= predicate.gt))
    return false;
  if (predicate.lte !== undefined && (numeric === undefined || numeric > predicate.lte))
    return false;
  if (predicate.lt !== undefined && (numeric === undefined || numeric >= predicate.lt))
    return false;
  return true;
}

function matchesWhere(
  metadata: Record<string, unknown> | undefined,
  where: WhereClause | undefined,
): boolean {
  if (!where) return true;
  for (const [field, expected] of Object.entries(where)) {
    const actual = metadata?.[field];
    if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
      if (!predicateMatches(actual, expected)) return false;
    } else if (Array.isArray(expected)) {
      if (!expected.some((value) => scalarMatches(actual, value))) return false;
    } else if (!scalarMatches(actual, expected)) return false;
  }
  return true;
}

function facetValueKeys(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      values
        .filter(
          (entry): entry is FilterScalar =>
            entry === null || ["string", "number", "boolean"].includes(typeof entry),
        )
        .map(String),
    ),
  ];
}

function facetCounts(
  results: SearchResult[],
  fields: string[] | undefined,
): QueryResponse["facets"] {
  if (!fields || fields.length === 0) return undefined;
  const facets: NonNullable<QueryResponse["facets"]> = {};
  for (const field of fields) {
    const counts: Record<string, number> = {};
    for (const result of results) {
      for (const value of facetValueKeys(result.metadata?.[field]))
        counts[value] = (counts[value] ?? 0) + 1;
    }
    facets[field] = counts;
  }
  return facets;
}

function groupResults(results: SearchResult[], group: QueryOptions["group"]): SearchResult[] {
  if (group === "none")
    return results.map((result) => ({
      ...result,
      document: { id: result.documentId, matches: 1 },
    }));
  const groups = new Map<string, SearchResult[]>();
  for (const result of results) {
    const key = `${result.corpus}\0${result.documentId}`;
    const entries = groups.get(key);
    if (entries) entries.push(result);
    else groups.set(key, [result]);
  }
  return [...groups.values()]
    .map((entries) => {
      const [best] = entries;
      const chunks = entries.map((entry) => ({
        ...entry,
        document: { id: entry.documentId, matches: entries.length },
      }));
      return {
        ...best!,
        document: {
          id: best!.documentId,
          matches: entries.length,
          chunks: group === "expanded" ? chunks : undefined,
        },
      };
    })
    .sort(compareResults);
}

function compareResults(left: SearchResult, right: SearchResult): number {
  return (
    right.score - left.score ||
    left.corpus.localeCompare(right.corpus) ||
    left.id.localeCompare(right.id)
  );
}

function v1MatchedTerms(index: LexicalIndex, query: string, chunk: number): MatchedTerm[] {
  return [...new Set(tokenize(query))]
    .filter((term) => index.postings[term]?.some(([index_]) => index_ === chunk))
    .map((term) => ({ term, source: term, kind: "exact" }));
}

function postingURL(corpus: LoadedCorpusV2, shard: number): string {
  return joinURL(corpus.root, `lexical/postings-${String(shard).padStart(3, "0")}.bin`);
}

function cloneWithoutExpanded(result: SearchResult): SearchResult {
  return { ...result, document: { id: result.document.id, matches: result.document.matches } };
}

async function hydrateResult(
  result: SearchResult,
  corpora: Map<string, LoadedCorpus>,
  fetcher: typeof fetch,
): Promise<SearchResult> {
  const corpus = corpora.get(result.corpus);
  if (!corpus || corpus.version === 1) return result;
  const index = corpus.chunkById.get(result.id);
  if (index === undefined) return result;
  const hydrated = await hydrateChunk(corpus, index, fetcher);
  const chunks = result.document.chunks
    ? await Promise.all(
        result.document.chunks.map((chunk) =>
          hydrateResult(cloneWithoutExpanded(chunk), corpora, fetcher),
        ),
      )
    : undefined;
  return { ...result, ...hydrated, document: { ...result.document, chunks } };
}

export function createSearch(options: CreateSearchOptions = {}): SearchClient {
  const indexURL = resolveIndexURL(options);
  const fetcher = options.fetch ?? globalThis.fetch;
  if (!fetcher) throw new Error("Seekite requires a fetch implementation");
  const corpora = new Map<string, LoadedCorpus>();
  const loading = new Map<string, Promise<void>>();
  const providers = providerMap(options);
  let manifestPromise: Promise<SearchManifest> | undefined;

  const manifest = () =>
    (manifestPromise ??= fetchJSON<SearchManifest>(
      fetcher,
      joinURL(indexURL, "manifest.json"),
    ).then((value) => {
      if (value.format !== "seekite" || (value.version !== 1 && value.version !== 2)) {
        throw new Error(
          `Unsupported Seekite index format: ${String((value as { version?: unknown }).version)}`,
        );
      }
      return value;
    }));

  async function loadCorpus(name: string): Promise<void> {
    if (corpora.has(name)) return;
    const existing = loading.get(name);
    if (existing) return existing;
    const pending = (async () => {
      const definition = (await manifest()).corpora[name];
      if (!definition) throw new Error(`Unknown Seekite corpus: ${name}`);
      const root = joinURL(indexURL, definition.path);
      if (isV2(definition)) {
        const [metadata, dictionaryBuffer, vectorsBuffer] = await Promise.all([
          fetchJSON<CorpusMetadataV2>(fetcher, joinURL(root, definition.corpus)),
          fetchBuffer(fetcher, joinURL(root, definition.lexical.dictionary)),
          definition.vectors
            ? fetchBuffer(fetcher, joinURL(root, definition.vectors.file))
            : undefined,
        ]);
        const lexical = decodeDictionaryV2(dictionaryBuffer);
        if (
          metadata.version !== 2 ||
          metadata.chunks.id.length !== definition.chunks ||
          lexical.documentCount !== definition.chunks
        ) {
          throw new SeekiteFormatError(`Seekite corpus ${name} has inconsistent chunk counts`);
        }
        const vectors =
          vectorsBuffer && definition.embedding
            ? decodeVectorsV2(vectorsBuffer, definition.embedding.dimensions)
            : undefined;
        if (vectors && vectors.count !== definition.chunks)
          throw new SeekiteFormatError(`Seekite corpus ${name} has inconsistent vector count`);
        corpora.set(name, {
          version: 2,
          root,
          definition,
          metadata,
          lexical,
          vectors,
          postings: new LruPromises(32),
          content: new LruPromises(16),
          chunkById: new Map(metadata.chunks.id.map((id, index) => [id, index])),
        });
      } else {
        const [metadata, lexicalBuffer, vectorsBuffer] = await Promise.all([
          fetchJSON<CorpusMetadataV1>(fetcher, joinURL(root, definition.metadata)),
          fetchBuffer(fetcher, joinURL(root, definition.lexical)),
          definition.vectors ? fetchBuffer(fetcher, joinURL(root, definition.vectors)) : undefined,
        ]);
        if (metadata.version !== 1 || metadata.chunks.length !== definition.chunks)
          throw new Error(`Seekite corpus ${name} has inconsistent chunk counts`);
        corpora.set(name, {
          version: 1,
          root,
          definition,
          metadata,
          lexical: decodeLexicalIndex(lexicalBuffer),
          vectors:
            vectorsBuffer && definition.embedding
              ? decodeVectors(vectorsBuffer, definition.embedding.dimensions)
              : undefined,
        });
      }
    })().finally(() => loading.delete(name));
    loading.set(name, pending);
    return pending;
  }

  async function query(value: string, queryOptions: QueryOptions = {}): Promise<QueryResponse> {
    const searchManifest = await manifest();
    const names = queryOptions.corpora ? [...queryOptions.corpora] : [...corpora.keys()];
    if (names.length === 0) names.push(...Object.keys(searchManifest.corpora));
    await Promise.all(names.map(loadCorpus));
    const mode = queryOptions.mode ?? "hybrid";
    const semanticWeight = Math.min(1, Math.max(0, queryOptions.semanticWeight ?? 0.5));
    const results: SearchResult[] = [];
    const queryVectors = new Map<string, Promise<Float32Array>>();

    for (const name of names) {
      const corpus = corpora.get(name)!;
      let lexicalScores = new Map<number, number>();
      let lexicalTerms = new Map<number, MatchedTerm[]>();
      if (mode !== "semantic") {
        if (corpus.version === 1) {
          lexicalScores = searchLexical(corpus.lexical, value);
          lexicalTerms = new Map(
            [...lexicalScores].map(([index]) => [
              index,
              v1MatchedTerms(corpus.lexical, value, index),
            ]),
          );
        } else {
          const analyzer = analyzerFor(corpus.definition, options.analyzers);
          if (corpus.definition.analyzer.stemmer?.startsWith("custom:") && !analyzer.custom) {
            throw new Error(
              `Corpus ${name} requires custom analyzer ${corpus.definition.analyzer.stemmer}`,
            );
          }
          const expansions = expandQueryTerms(
            corpus.lexical.terms,
            value,
            analyzer,
            queryOptions.maxExpansions,
          );
          const shards = [
            ...new Set(
              expansions.map((entry) => corpus.lexical.terms[entry.dictionaryIndex]!.shard),
            ),
          ];
          const shardBuffers = new Map<number, ArrayBuffer>();
          await Promise.all(
            shards.map(async (shard) => {
              const data = await corpus.postings.get(shard, async () => {
                const buffer = await fetchBuffer(fetcher, postingURL(corpus, shard));
                const expected = corpus.lexical.shardByteLengths[shard];
                if (expected !== undefined && buffer.byteLength !== expected) {
                  throw new SeekiteFormatError(
                    `Seekite postings shard ${shard} has an invalid byte length`,
                  );
                }
                return buffer;
              });
              shardBuffers.set(shard, data);
            }),
          );
          const postings = new Map(
            expansions.map((entry) => {
              const definition = corpus.lexical.terms[entry.dictionaryIndex]!;
              return [
                entry.dictionaryIndex,
                decodePostingsV2(
                  shardBuffers.get(definition.shard)!,
                  definition.offset,
                  definition.documentFrequency,
                  corpus.lexical.documentCount,
                ),
              ];
            }),
          );
          const scored = scoreLexicalV2(corpus.lexical, expansions, postings, {
            ...corpus.definition.fields,
            ...queryOptions.fields,
          });
          lexicalScores = scored.scores;
          lexicalTerms = scored.terms;
        }
      }

      const maxLexical = Math.max(0, ...lexicalScores.values());
      let queryVector: Float32Array | undefined;
      const vectors =
        mode === "lexical" ? undefined : await corpusVectors(name, corpus, providers, fetcher);
      const embedding = corpus.definition.embedding;
      if (mode !== "lexical" && vectors && embedding) {
        const provider = providers[embedding.provider];
        if (provider) {
          let pending = queryVectors.get(provider.id);
          if (!pending) {
            pending = provider.embedQuery(value);
            queryVectors.set(provider.id, pending);
          }
          queryVector = await pending;
          validateVector(provider, queryVector, embedding.dimensions);
        }
      }

      const chunkCount =
        corpus.version === 1 ? corpus.metadata.chunks.length : corpus.metadata.chunks.id.length;
      for (let index = 0; index < chunkCount; index += 1) {
        const chunk =
          corpus.version === 1 ? corpus.metadata.chunks[index]! : chunkV2(corpus, index);
        if (!matchesWhere(chunk.metadata, queryOptions.where)) continue;
        const lexicalScore = (lexicalScores.get(index) ?? 0) / (maxLexical || 1);
        const similarity_ =
          queryVector && vectors ? similarity(vectors, index, queryVector) : undefined;
        const semanticScore = similarity_ === undefined ? undefined : (similarity_ + 1) / 2;
        const score =
          mode === "lexical" || semanticScore === undefined
            ? lexicalScore
            : mode === "semantic"
              ? semanticScore
              : lexicalScore * (1 - semanticWeight) + semanticScore * semanticWeight;
        if (score <= 0) continue;
        const terms =
          lexicalTerms.get(index) ??
          (semanticScore !== undefined
            ? [{ term: "", source: "", kind: "semantic-none" as const }]
            : []);
        results.push({
          ...chunk,
          corpus: name,
          score,
          lexicalScore: mode === "semantic" ? undefined : lexicalScore,
          semanticScore,
          terms,
          document: { id: chunk.documentId, matches: 1 },
        });
      }
    }

    results.sort(compareResults);
    const grouped = groupResults(results, queryOptions.group ?? "document");
    const facets = facetCounts(grouped, queryOptions.facets);
    const total = grouped.length;
    const offset = Math.max(0, Math.floor(queryOptions.offset ?? 0));
    const limit = Math.max(0, Math.floor(queryOptions.limit ?? 10));
    let page = grouped.slice(offset, offset + limit);
    if (queryOptions.hydrate !== false)
      page = await Promise.all(page.map((result) => hydrateResult(result, corpora, fetcher)));
    return { results: page, total, facets };
  }

  async function warmup(): Promise<void> {
    const searchManifest = await manifest();
    await Promise.all(Object.keys(searchManifest.corpora).map(loadCorpus));
    const initialized = new Set<string>();
    await Promise.all(
      Object.values(searchManifest.corpora).map(async (definition) => {
        const embedding = definition.embedding;
        const provider = embedding && providers[embedding.provider];
        if (!provider || initialized.has(provider.id)) return;
        initialized.add(provider.id);
        const vector = await provider.embedQuery("");
        validateVector(provider, vector, embedding!.dimensions);
      }),
    );
  }

  return { load: loadCorpus, query, loaded: () => [...corpora.keys()], warmup };
}

export function highlightRanges(
  text: string,
  terms: MatchedTerm[],
): Array<[start: number, end: number]> {
  const lexicalTerms = terms.filter((term) => term.kind !== "semantic-none");
  if (lexicalTerms.length === 0) return [];
  const ranges: Array<[number, number]> = [];
  for (const token of tokenizeWithOffsets(text, { folding: true, stemmer: null })) {
    const folded = fold(token.raw);
    const stemmed = stemEnglish(folded);
    const matches = lexicalTerms.some((term) =>
      term.kind === "prefix"
        ? folded.startsWith(term.source) || folded === term.term || stemmed === term.term
        : folded === term.term || stemmed === term.term,
    );
    if (matches) ranges.push([token.start, token.end]);
  }
  return ranges.filter(
    (range, index) =>
      index === 0 || range[0] !== ranges[index - 1]![0] || range[1] !== ranges[index - 1]![1],
  );
}

export function snippet(
  text: string,
  terms: MatchedTerm[],
  options: { radius?: number; maxRanges?: number } = {},
): { text: string; ranges: Array<[start: number, end: number]> } {
  const radius = Math.max(10, Math.floor(options.radius ?? 80));
  const allRanges = highlightRanges(text, terms);
  const anchor = allRanges[0]?.[0] ?? 0;
  let start = Math.max(0, anchor - radius);
  let end = Math.min(text.length, anchor + radius);
  if (start > 0) {
    const boundary = text.indexOf(" ", start);
    if (boundary >= 0 && boundary < anchor) start = boundary + 1;
  }
  if (end < text.length) {
    const boundary = text.lastIndexOf(" ", end);
    if (boundary > anchor) end = boundary;
  }
  const leading = start > 0 ? "…" : "";
  const trailing = end < text.length ? "…" : "";
  const selected = allRanges
    .filter(([rangeStart, rangeEnd]) => rangeEnd > start && rangeStart < end)
    .slice(0, Math.max(0, options.maxRanges ?? 8))
    .map(([rangeStart, rangeEnd]): [number, number] => [
      Math.max(rangeStart, start) - start + leading.length,
      Math.min(rangeEnd, end) - start + leading.length,
    ]);
  return { text: `${leading}${text.slice(start, end)}${trailing}`, ranges: selected };
}
