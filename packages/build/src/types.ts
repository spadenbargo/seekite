import type {
  EmbeddingProvider,
  LexicalField,
  QueryOptions,
  SearchDocument,
  VectorDType,
} from "@seekite/core";

export interface SourceContext {
  root: string;
  generatedDir: string;
}

export interface SourceAdapter {
  name: string;
  load(context: SourceContext): SearchDocument[] | Promise<SearchDocument[]>;
}

export type SourceLoader = (context: SourceContext) => SearchDocument[] | Promise<SearchDocument[]>;

export type CorpusSource = SourceAdapter | SourceLoader | SearchDocument[] | string;

export interface StaticVectorsConfig {
  mode: "static";
  provider: EmbeddingProvider;
  quantize: VectorDType;
}

export type EmbeddingDescriptor = Pick<EmbeddingProvider, "id" | "dimensions">;

export interface RuntimeVectorsConfig {
  mode: "runtime";
  provider: EmbeddingDescriptor;
}

export type VectorConfig = StaticVectorsConfig | RuntimeVectorsConfig | false;

export interface CorpusConfig {
  include?: string[];
  exclude?: string[];
  source?: CorpusSource;
  vectors?: VectorConfig;
  /** @deprecated Use `vectors: staticVectors(provider)`. */
  embeddings?: EmbeddingProvider | false;
  chunk?: {
    maxWords?: number;
    overlapWords?: number;
  };
  /** Enables the bundled light English stemmer. */
  lang?: "en";
  /** Custom lexical stemmer. Its stable id is recorded in the manifest. */
  analyzer?: {
    id: string;
    stem(token: string): string;
  };
  /** Metadata fields copied into the scored corpus columns. */
  filters?: string[];
  /** Filter fields whose global and per-query counts are exposed. */
  facets?: string[];
  /** Default BM25F weights; callers may still override these per query. */
  fields?: Partial<Record<LexicalField, number>>;
}

export type BenchCandidateConfig = Partial<CorpusConfig> & { query?: QueryOptions };

export interface BenchConfig {
  corpus?: string;
  candidates: Record<string, BenchCandidateConfig>;
  queries?: string;
  k?: number;
  seed?: number;
}

export interface SearchConfig {
  corpora: Record<string, CorpusConfig>;
  output?: string;
  generatedDir?: string;
  format?: 1 | 2;
  bench?: BenchConfig;
}

export interface BuildOptions {
  root?: string;
  outputDir?: string;
  generatedDir?: string;
  /** Read the embedding cache. False still writes fresh rows to warm it. */
  cache?: boolean;
  /** Override `.seekite/cache` (SEEKITE_CACHE_DIR is used when omitted). */
  cacheDir?: string;
  /** Receives recoverable cache corruption and mismatch warnings. */
  onCacheWarning?: (message: string) => void;
  /** Output format. Defaults to v2; v1 remains a temporary compatibility escape hatch. */
  format?: 1 | 2;
}

export interface CorpusBuildResult {
  documents: number;
  chunks: number;
  /** Number of chunk vectors read from the content-addressed cache. */
  cached?: number;
  /** Number of unique chunk texts sent to the embedding provider. */
  embedded?: number;
  /** Total static-vector resolution time, in milliseconds. */
  durationMs?: number;
}

export interface BuildResult {
  outputDir: string;
  corpora: Record<string, CorpusBuildResult>;
}

export function staticVectors(
  provider: EmbeddingProvider,
  options: { quantize?: VectorDType } = {},
): StaticVectorsConfig {
  return { mode: "static", provider, quantize: options.quantize ?? "i8" };
}

export function runtimeVectors(provider: EmbeddingDescriptor): RuntimeVectorsConfig {
  return { mode: "runtime", provider };
}

export function defineSource(name: string, load: SourceLoader): SourceAdapter {
  return { name, load };
}
