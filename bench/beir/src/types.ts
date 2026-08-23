export const DATASET_NAMES = ["scifact", "nfcorpus", "arguana"] as const;
export type DatasetName = (typeof DATASET_NAMES)[number];

export const ENGINE_NAMES = ["seekite", "zbsearch", "orama", "minisearch"] as const;
export type EngineName = (typeof ENGINE_NAMES)[number];

export const CANDIDATE_NAMES = ["lexical", "hybrid"] as const;
export type CandidateName = (typeof CANDIDATE_NAMES)[number];

export interface BeirDocument {
  id: string;
  title: string;
  text: string;
}

export interface BeirQuery {
  id: string;
  text: string;
}

export type QueryQrels = Map<string, number>;
export type Qrels = Map<string, QueryQrels>;
export type RankedRuns = Map<string, string[]>;

export interface LoadedDataset {
  name: DatasetName;
  documents: BeirDocument[];
  queries: BeirQuery[];
  qrels: Qrels;
}

export interface QualityMetrics {
  ndcg10: number;
  map100: number;
  recall100: number;
  precision10: number;
  mrr10: number;
}

export interface EngineBuildContext {
  candidate: CandidateName;
  dataset: DatasetName;
  temporaryDirectory: string;
  cacheDirectory: string;
}

export interface BuiltEngine {
  search(query: string, limit: number): Promise<string[]>;
  dispose?(): Promise<void> | void;
}

export interface EngineAdapter {
  name: EngineName;
  label: string;
  candidates: readonly CandidateName[];
  build(documents: readonly BeirDocument[], context: EngineBuildContext): Promise<BuiltEngine>;
}
