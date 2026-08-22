import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createLexicalIndex,
  createLexicalIndexV2,
  embeddingText,
  encodeLexicalIndex,
  encodeLexicalV2,
  encodeVectors,
  encodeVectorsV2,
  type AnalyzerManifest,
  type ContentShardV2,
  type CorpusManifest,
  type CorpusManifestV1,
  type CorpusManifestV2,
  type CorpusMetadataV1,
  type CorpusMetadataV2,
  type EmbeddingManifest,
  type SearchChunk,
  type SearchDocument,
  type SearchManifest,
} from "@seekite/core";
import picomatch from "picomatch";
import { embedDocumentsCached } from "./cache.js";
import { chunkDocument } from "./chunk.js";
import { filesystem, generatedHTML } from "./sources.js";
import {
  staticVectors,
  type BuildOptions,
  type BuildResult,
  type CorpusConfig,
  type SearchConfig,
  type SourceContext,
  type VectorConfig,
} from "./types.js";

const LEXICAL_SHARD_TARGET = 64 * 1024;
const CONTENT_SHARD_TARGET = 128 * 1024;

interface ResolvedVectors {
  embedding?: EmbeddingManifest;
  vectors?: Float32Array[];
  stats?: Pick<NonNullable<BuildResult["corpora"][string]>, "cached" | "embedded" | "durationMs">;
}

function matchesRoute(url: string, corpus: CorpusConfig): boolean {
  const include = corpus.include ?? ["/**"];
  const excluded = corpus.exclude ?? [];
  return (
    include.some((pattern) => picomatch(pattern)(url)) &&
    !excluded.some((pattern) => picomatch(pattern)(url))
  );
}

async function loadDocuments(
  corpus: CorpusConfig,
  context: SourceContext,
): Promise<SearchDocument[]> {
  if (Array.isArray(corpus.source)) return corpus.source;
  if (typeof corpus.source === "string") return filesystem(corpus.source).load(context);
  if (typeof corpus.source === "function") return corpus.source(context);
  if (corpus.source) return corpus.source.load(context);
  return generatedHTML().load(context);
}

function resolveVectorConfig(corpus: CorpusConfig): VectorConfig {
  if (corpus.vectors !== undefined) return corpus.vectors;
  return corpus.embeddings ? staticVectors(corpus.embeddings) : false;
}

function environmentDisablesCache(): boolean {
  const value = process.env["SEEKITE_NO_CACHE"];
  return value !== undefined && value !== "" && value !== "0" && value.toLowerCase() !== "false";
}

function analyzerConfig(corpus: CorpusConfig): {
  manifest: AnalyzerManifest;
  stem?: (token: string) => string;
} {
  if (corpus.lang === "en" && corpus.analyzer)
    throw new Error("A corpus cannot configure both lang and a custom analyzer");
  if (corpus.analyzer) {
    const analyzer = corpus.analyzer;
    const id = analyzer.id.replace(/^custom:/, "").trim();
    if (!id) throw new Error("A custom analyzer requires a stable non-empty id");
    return {
      manifest: { folding: true, stemmer: `custom:${id}` },
      stem: (token) => analyzer.stem(token),
    };
  }
  return { manifest: { folding: true, stemmer: corpus.lang === "en" ? "en" : null } };
}

async function resolveVectors(
  corpus: CorpusConfig,
  chunks: SearchChunk[],
  root: string,
  options: BuildOptions,
): Promise<ResolvedVectors> {
  const vectorConfig = resolveVectorConfig(corpus);
  if (!vectorConfig) return {};
  const embedding: EmbeddingManifest = {
    provider: vectorConfig.provider.id,
    dimensions: vectorConfig.provider.dimensions,
    mode: vectorConfig.mode,
  };
  if (vectorConfig.mode === "runtime") return { embedding };
  const provider = vectorConfig.provider;
  const startedAt = performance.now();
  const resolved = await embedDocumentsCached(provider, chunks.map(embeddingText), {
    root,
    cacheDir: options.cacheDir,
    read: options.cache !== false && !environmentDisablesCache(),
    onWarning: options.onCacheWarning,
  });
  if (resolved.vectors.length !== chunks.length) {
    throw new Error(
      `Embedding provider ${provider.id} returned ${resolved.vectors.length} vectors for ${chunks.length} chunks`,
    );
  }
  for (const vector of resolved.vectors) {
    if (vector.length !== provider.dimensions) {
      throw new Error(
        `Embedding provider ${provider.id} returned ${vector.length} dimensions; expected ${provider.dimensions}`,
      );
    }
  }
  return {
    embedding,
    vectors: resolved.vectors,
    stats: {
      cached: resolved.cached,
      embedded: resolved.embedded,
      durationMs: performance.now() - startedAt,
    },
  };
}

function filterFields(corpus: CorpusConfig): string[] {
  return [...new Set([...(corpus.filters ?? []), ...(corpus.facets ?? [])])];
}

function facetKeys(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      values
        .filter((entry) => entry === null || ["string", "number", "boolean"].includes(typeof entry))
        .map(String),
    ),
  ];
}

function globalFacets(chunks: SearchChunk[], fields: string[]): CorpusMetadataV2["facets"] {
  return Object.fromEntries(
    fields.map((field) => {
      const counts: Record<string, number> = {};
      for (const chunk of chunks)
        for (const value of facetKeys(chunk.metadata?.[field]))
          counts[value] = (counts[value] ?? 0) + 1;
      return [field, counts];
    }),
  );
}

function contentEntry(
  chunk: SearchChunk,
  indexedFields: Set<string>,
): ContentShardV2["chunks"][number] {
  const metadata = Object.fromEntries(
    Object.entries(chunk.metadata ?? {}).filter(([field]) => !indexedFields.has(field)),
  );
  return {
    content: chunk.content,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

function packContent(
  chunks: SearchChunk[],
  indexedFields: Set<string>,
  targetBytes = CONTENT_SHARD_TARGET,
): { shards: ContentShardV2[]; locations: Array<[number, number]> } {
  const shards: ContentShardV2[] = [];
  const locations: Array<[number, number]> = [];
  let entries: ContentShardV2["chunks"] = [];
  let bytes = 0;
  const flush = () => {
    if (entries.length === 0) return;
    shards.push({ version: 2, chunks: entries });
    entries = [];
    bytes = 0;
  };
  for (const chunk of chunks) {
    const entry = contentEntry(chunk, indexedFields);
    const entryBytes = Buffer.byteLength(JSON.stringify(entry)) + 1;
    if (entries.length > 0 && bytes + entryBytes > targetBytes) flush();
    locations.push([shards.length, entries.length]);
    entries.push(entry);
    bytes += entryBytes;
  }
  flush();
  return { shards, locations };
}

async function cleanCorpusDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await Promise.all(
    ["metadata.json", "lexical.bin", "corpus.json", "vectors.bin", "lexical", "content"].map(
      (entry) => rm(path.join(directory, entry), { recursive: true, force: true }),
    ),
  );
}

async function writeFormatV1(
  name: string,
  directory: string,
  chunks: SearchChunk[],
  resolved: ResolvedVectors,
): Promise<CorpusManifestV1> {
  const metadata: CorpusMetadataV1 = { version: 1, name, chunks };
  const lexical = createLexicalIndex(
    chunks.map((chunk) => `${chunk.title} ${chunk.heading ?? ""} ${chunk.content}`),
  );
  await Promise.all([
    writeFile(path.join(directory, "metadata.json"), `${JSON.stringify(metadata)}\n`),
    writeFile(path.join(directory, "lexical.bin"), encodeLexicalIndex(lexical)),
    resolved.vectors && resolved.embedding
      ? writeFile(
          path.join(directory, "vectors.bin"),
          encodeVectors(resolved.vectors, resolved.embedding.dimensions),
        )
      : Promise.resolve(),
  ]);
  return {
    name,
    path: name,
    chunks: chunks.length,
    lexical: "lexical.bin",
    metadata: "metadata.json",
    vectors: resolved.vectors ? "vectors.bin" : undefined,
    embedding: resolved.embedding,
  };
}

async function writeFormatV2(
  name: string,
  directory: string,
  corpus: CorpusConfig,
  chunks: SearchChunk[],
  resolved: ResolvedVectors,
): Promise<CorpusManifestV2> {
  const analyzer = analyzerConfig(corpus);
  const vectorConfig = resolveVectorConfig(corpus);
  const vectorDType = vectorConfig && vectorConfig.mode === "static" ? vectorConfig.quantize : "i8";
  const lexical = encodeLexicalV2(
    createLexicalIndexV2(chunks, {
      ...analyzer.manifest,
      custom: analyzer.stem,
    }),
    LEXICAL_SHARD_TARGET,
  );
  const fields = filterFields(corpus);
  const fieldSet = new Set(fields);
  const packedContent = packContent(chunks, fieldSet);
  const documents: string[] = [];
  const documentIndex = new Map<string, number>();
  const documentColumn = chunks.map((chunk) => {
    let index = documentIndex.get(chunk.documentId);
    if (index === undefined) {
      index = documents.length;
      documentIndex.set(chunk.documentId, index);
      documents.push(chunk.documentId);
    }
    return index;
  });
  const metadata: CorpusMetadataV2 = {
    version: 2,
    name,
    documents,
    chunks: {
      id: chunks.map((chunk) => chunk.id),
      document: documentColumn,
      url: chunks.map((chunk) => chunk.url),
      title: chunks.map((chunk) => chunk.title),
      heading: chunks.map((chunk) => chunk.heading ?? ""),
      content: packedContent.locations,
      filters: Object.fromEntries(
        fields.map((field) => [field, chunks.map((chunk) => chunk.metadata?.[field] ?? null)]),
      ),
    },
    facets: globalFacets(chunks, corpus.facets ?? []),
  };

  const lexicalDirectory = path.join(directory, "lexical");
  const contentDirectory = path.join(directory, "content");
  await Promise.all([
    mkdir(lexicalDirectory, { recursive: true }),
    mkdir(contentDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(directory, "corpus.json"), `${JSON.stringify(metadata)}\n`),
    writeFile(path.join(lexicalDirectory, "dictionary.bin"), lexical.dictionary),
    ...lexical.shards.map((shard, index) =>
      writeFile(
        path.join(lexicalDirectory, `postings-${String(index).padStart(3, "0")}.bin`),
        shard,
      ),
    ),
    ...packedContent.shards.map((shard, index) =>
      writeFile(
        path.join(contentDirectory, `content-${String(index).padStart(3, "0")}.json`),
        `${JSON.stringify(shard)}\n`,
      ),
    ),
    resolved.vectors && resolved.embedding
      ? writeFile(
          path.join(directory, "vectors.bin"),
          encodeVectorsV2(resolved.vectors, resolved.embedding.dimensions, vectorDType),
        )
      : Promise.resolve(),
  ]);
  return {
    name,
    path: name,
    chunks: chunks.length,
    format: 2,
    corpus: "corpus.json",
    lexical: { dictionary: "lexical/dictionary.bin", shards: lexical.shards.length },
    content: { prefix: "content/content-", shards: packedContent.shards.length },
    vectors:
      resolved.vectors && vectorConfig && vectorConfig.mode === "static"
        ? { file: "vectors.bin", dtype: vectorConfig.quantize }
        : undefined,
    embedding: resolved.embedding,
    analyzer: analyzer.manifest,
    fields: corpus.fields,
  };
}

function validateCorpusName(name: string): void {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    throw new Error(`Invalid corpus name: ${JSON.stringify(name)}`);
  }
}

export function defineSearch<const Config extends SearchConfig>(config: Config): Config {
  return config;
}

export async function buildSearch(
  config: SearchConfig,
  options: BuildOptions = {},
): Promise<BuildResult> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedDir = options.generatedDir ?? config.generatedDir ?? "dist";
  const outputDir = path.resolve(
    root,
    options.outputDir ?? config.output ?? path.join(generatedDir, "search"),
  );
  const format = options.format ?? config.format ?? 2;
  const manifest: SearchManifest =
    format === 1
      ? { format: "seekite", version: 1, generatedAt: new Date().toISOString(), corpora: {} }
      : { format: "seekite", version: 2, generatedAt: new Date().toISOString(), corpora: {} };
  const result: BuildResult = { outputDir, corpora: {} };
  await mkdir(outputDir, { recursive: true });

  const configuredNames = new Set(Object.keys(config.corpora));
  const existing = await readdir(outputDir, { withFileTypes: true });
  await Promise.all(
    existing
      .filter((entry) => entry.isDirectory() && !configuredNames.has(entry.name))
      .map((entry) => rm(path.join(outputDir, entry.name), { recursive: true, force: true })),
  );

  for (const [name, corpus] of Object.entries(config.corpora)) {
    validateCorpusName(name);
    const documents = (await loadDocuments(corpus, { root, generatedDir })).filter((document) =>
      matchesRoute(document.url, corpus),
    );
    const chunks = documents.flatMap((document) => chunkDocument(document, corpus.chunk));
    const directory = path.join(outputDir, name);
    await cleanCorpusDirectory(directory);
    const resolved = await resolveVectors(corpus, chunks, root, options);
    const definition: CorpusManifest =
      format === 1
        ? await writeFormatV1(name, directory, chunks, resolved)
        : await writeFormatV2(name, directory, corpus, chunks, resolved);
    if (manifest.version === 1 && definition.format !== 2) manifest.corpora[name] = definition;
    else if (manifest.version === 2 && definition.format === 2) manifest.corpora[name] = definition;
    else throw new Error("Seekite internal format mismatch");
    result.corpora[name] = {
      documents: documents.length,
      chunks: chunks.length,
      ...resolved.stats,
    };
  }

  await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return result;
}
