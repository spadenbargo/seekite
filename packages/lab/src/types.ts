import type { CorpusConfig, SearchConfig } from "@seekite/build";
import type { QueryOptions, SearchMode } from "@seekite/core";

export interface EvalJudgment {
  query: string;
  relevant: string[];
  notes?: string;
  synthetic?: boolean;
}

export interface BenchCandidate extends Partial<CorpusConfig> {
  query?: QueryOptions;
}

export interface BenchConfiguration {
  corpus?: string;
  candidates: Record<string, BenchCandidate>;
  queries?: string;
  k?: number;
  seed?: number;
}

export type SearchConfigWithBench = SearchConfig & { bench?: BenchConfiguration };

export interface QualityMetrics {
  recall: number;
  mrr: number;
  ndcg: number;
}

export interface EmbedMetrics {
  seconds: number;
  textsPerSec: number;
  backend: string;
  cacheHits: number;
}

export interface QueryMetrics {
  p50ms: number;
  p95ms: number;
}

export interface ArtifactMetrics {
  lexicalBytes: number;
  vectorsBytes: number;
  metadataBytes: number;
  totalBytes: number;
  gzip: {
    lexicalBytes: number;
    vectorsBytes: number;
    metadataBytes: number;
    totalBytes: number;
  };
}

export interface BenchHit {
  id: string;
  documentId: string;
  title: string;
  url: string;
  score: number;
  lexicalScore?: number;
  semanticScore?: number;
}

export interface PerQueryCandidate {
  rank?: number;
  hits: BenchHit[];
}

export interface PerQueryResult {
  query: string;
  relevant: string[];
  candidates: Record<string, Partial<Record<SearchMode, PerQueryCandidate>>>;
}

export interface CandidateRun {
  quality: Partial<Record<SearchMode, QualityMetrics>>;
  embed: EmbedMetrics;
  query: QueryMetrics;
  artifacts: ArtifactMetrics;
}

export interface BenchRun {
  version: 1;
  label: string;
  synthetic: boolean;
  createdAt: string;
  config: {
    corpus: string;
    k: number;
    candidates: Record<string, { provider?: string; query?: QueryOptions }>;
  };
  environment: {
    node: string;
    cpu: string;
    platform: string;
    backend: string;
    seekite: string;
  };
  candidates: Record<string, CandidateRun>;
  perQuery: PerQueryResult[];
}

export interface BenchOptions {
  root?: string;
  label?: string;
  outputDir?: string;
  cold?: boolean;
  quiet?: boolean;
  /** Backend selected by the host CLI for Seekite's local Ternlight provider. */
  backend?: "native" | "wasm";
}

export interface ComparisonDelta {
  candidate: string;
  mode: SearchMode;
  recall: number;
  mrr: number;
  ndcg: number;
}

export interface BenchComparison {
  deltas: ComparisonDelta[];
  tolerance: number;
  regressions: ComparisonDelta[];
  passed: boolean;
}

export interface SyntheticChunk {
  id: string;
  documentId: string;
  title: string;
  heading?: string;
  content: string;
}

export interface ServeLabOptions {
  root?: string;
  config?: SearchConfigWithBench;
  configFile?: string;
  host?: string;
  port?: number;
  open?: boolean;
}
