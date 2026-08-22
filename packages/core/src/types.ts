export const INDEX_FORMAT_VERSION = 2 as const;

export interface SearchDocument {
  id: string;
  url: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface SearchChunk {
  id: string;
  documentId: string;
  url: string;
  title: string;
  heading?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

/** Legacy format-v1 lexical payload. */
export interface LexicalIndexV1 {
  version: 1;
  documentCount: number;
  averageLength: number;
  lengths: number[];
  postings: Record<string, Array<[documentIndex: number, termFrequency: number]>>;
}

/** Kept as the v1 alias for source compatibility with early index producers. */
export type LexicalIndex = LexicalIndexV1;

export type LexicalField = "title" | "heading" | "body";
export type FieldLengths = [title: number[], heading: number[], body: number[]];
export type AverageFieldLengths = [title: number, heading: number, body: number];
export type FieldTermFrequencies = [title: number, heading: number, body: number];

export interface LexicalPostingV2 {
  chunk: number;
  frequencies: FieldTermFrequencies;
}

export interface LexicalTermV2 {
  term: string;
  postings: LexicalPostingV2[];
}

/** Builder-side representation before postings are packed into shards. */
export interface LexicalIndexV2 {
  version: 2;
  documentCount: number;
  averageFieldLengths: AverageFieldLengths;
  fieldLengths: FieldLengths;
  terms: LexicalTermV2[];
}

export interface DictionaryTermV2 {
  term: string;
  documentFrequency: number;
  shard: number;
  offset: number;
}

/** Runtime representation decoded from lexical/dictionary.bin. */
export interface LexicalDictionaryV2 {
  version: 2;
  documentCount: number;
  averageFieldLengths: AverageFieldLengths;
  fieldLengths: FieldLengths;
  terms: DictionaryTermV2[];
  shardByteLengths: number[];
}

export interface CorpusMetadataV1 {
  version: 1;
  name: string;
  chunks: SearchChunk[];
}

export interface CorpusColumnsV2 {
  id: string[];
  document: number[];
  url: string[];
  title: string[];
  heading: string[];
  content: Array<[shardIndex: number, indexInShard: number]>;
  filters: Record<string, unknown[]>;
}

export interface CorpusMetadataV2 {
  version: 2;
  name: string;
  documents: string[];
  chunks: CorpusColumnsV2;
  facets: Record<string, Record<string, number>>;
}

export type CorpusMetadata = CorpusMetadataV1 | CorpusMetadataV2;

export interface ContentShardV2 {
  version: 2;
  chunks: Array<{ content: string; metadata?: Record<string, unknown> }>;
}

export type VectorMode = "static" | "runtime";
export type VectorDType = "i8" | "f32";

export interface EmbeddingManifest {
  provider: string;
  dimensions: number;
  mode: VectorMode;
}

export interface CorpusManifestV1 {
  name: string;
  path: string;
  chunks: number;
  lexical: string;
  metadata: string;
  vectors?: string;
  embedding?: EmbeddingManifest;
  format?: 1;
}

export interface AnalyzerManifest {
  folding: boolean;
  stemmer: "en" | `custom:${string}` | null;
}

export interface CorpusManifestV2 {
  name: string;
  path: string;
  chunks: number;
  format: 2;
  corpus: string;
  lexical: { dictionary: string; shards: number };
  content: { prefix: string; shards: number };
  vectors?: { file: string; dtype: VectorDType };
  embedding?: EmbeddingManifest;
  analyzer: AnalyzerManifest;
  fields?: Partial<Record<LexicalField, number>>;
}

export type CorpusManifest = CorpusManifestV1 | CorpusManifestV2;

export interface SearchManifestV1 {
  format: "seekite";
  version: 1;
  generatedAt: string;
  corpora: Record<string, CorpusManifestV1>;
}

export interface SearchManifestV2 {
  format: "seekite";
  version: 2;
  generatedAt: string;
  corpora: Record<string, CorpusManifestV2>;
}

export type SearchManifest = SearchManifestV1 | SearchManifestV2;

export interface EmbeddingProvider {
  /** Stable cache/protocol identity. Change it whenever model output changes. */
  id: string;
  dimensions: number;
  embedDocuments(documents: string[]): Promise<Float32Array[]>;
  embedQuery(query: string): Promise<Float32Array>;
}

export type SearchMode = "lexical" | "semantic" | "hybrid";

export type FilterScalar = string | number | boolean | null;
export type FilterValue = FilterScalar | FilterScalar[];

export interface FilterPredicate {
  in?: FilterScalar[];
  gte?: number;
  gt?: number;
  lte?: number;
  lt?: number;
  exists?: boolean;
}

export type WhereClause = Record<string, FilterValue | FilterPredicate>;

export interface QueryOptions {
  corpora?: string[];
  mode?: SearchMode;
  semanticWeight?: number;
  fields?: Partial<Record<LexicalField, number>>;
  where?: WhereClause;
  facets?: string[];
  group?: "document" | "none" | "expanded";
  limit?: number;
  offset?: number;
  hydrate?: boolean;
  maxExpansions?: number;
}

export type MatchKind = "exact" | "prefix" | "fuzzy" | "semantic-none";

export interface MatchedTerm {
  /** Dictionary/display-side term that matched. */
  term: string;
  /** Analyzed token from the user's query. */
  source: string;
  kind: MatchKind;
  distance?: number;
}

export interface SearchResult extends SearchChunk {
  corpus: string;
  score: number;
  lexicalScore?: number;
  semanticScore?: number;
  terms: MatchedTerm[];
  document: {
    id: string;
    matches: number;
    chunks?: SearchResult[];
  };
}

export interface QueryResponse {
  results: SearchResult[];
  total: number;
  facets?: Record<string, Record<string, number>>;
}

export type CustomAnalyzer = (token: string) => string;
