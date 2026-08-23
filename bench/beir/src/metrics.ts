import type { Qrels, QualityMetrics, QueryQrels, RankedRuns } from "./types.js";

export const METRIC_DEFINITIONS = {
  ndcg10:
    "trec_eval ndcg_cut.10: linear gain; DCG is sum(rel_i / log2(i + 1)) divided by ideal DCG",
  map100:
    "trec_eval map_cut.100: precision at each relevant rank divided by all relevant documents in qrels",
  recall100: "trec_eval recall.100: relevant retrieved in the top 100 divided by relevant",
  precision10: "trec_eval P.10: relevant retrieved in the top 10 divided by 10",
  mrr10: "BEIR custom MRR@10: reciprocal rank of the first relevant hit in the top 10",
} as const;

export const ZERO_METRICS: Readonly<QualityMetrics> = {
  ndcg10: 0,
  map100: 0,
  recall100: 0,
  precision10: 0,
  mrr10: 0,
};

function assertRanking(run: readonly string[]): void {
  const unique = new Set(run);
  if (unique.size !== run.length) {
    throw new Error("A ranked run contains duplicate document ids");
  }
}

export function ndcgAtK(run: readonly string[], queryQrels: QueryQrels, k: number): number | null {
  assertRanking(run);
  let dcg = 0;
  for (const [index, documentId] of run.slice(0, k).entries()) {
    dcg += (queryQrels.get(documentId) ?? 0) / Math.log2(index + 2);
  }

  // trec_eval's ndcg_cut uses raw/linear relevance gain, not 2^rel - 1.
  const idealRelevances = [...queryQrels.values()];
  // eslint-disable-next-line unicorn/no-array-sort -- root tsconfig intentionally targets ES2022
  idealRelevances.sort((left, right) => right - left);
  const ideal = idealRelevances
    .slice(0, k)
    .reduce((sum, relevance, index) => sum + relevance / Math.log2(index + 2), 0);
  return ideal === 0 ? null : dcg / ideal;
}

function relevantCount(queryQrels: QueryQrels): number {
  return [...queryQrels.values()].filter((relevance) => relevance > 0).length;
}

export function averagePrecisionAtK(
  run: readonly string[],
  queryQrels: QueryQrels,
  k: number,
): number | null {
  assertRanking(run);
  const relevant = relevantCount(queryQrels);
  if (relevant === 0) return null;

  let hits = 0;
  let precisionSum = 0;
  for (const [index, documentId] of run.slice(0, k).entries()) {
    if ((queryQrels.get(documentId) ?? 0) <= 0) continue;
    hits += 1;
    precisionSum += hits / (index + 1);
  }
  // map_cut retains all relevant qrels in the denominator, including relevant
  // documents that occur below the cutoff or are absent from the run.
  return precisionSum / relevant;
}

export function recallAtK(
  run: readonly string[],
  queryQrels: QueryQrels,
  k: number,
): number | null {
  assertRanking(run);
  const relevant = relevantCount(queryQrels);
  if (relevant === 0) return null;
  const hits = run.slice(0, k).filter((documentId) => (queryQrels.get(documentId) ?? 0) > 0).length;
  return hits / relevant;
}

export function precisionAtK(run: readonly string[], queryQrels: QueryQrels, k: number): number {
  assertRanking(run);
  const hits = run.slice(0, k).filter((documentId) => (queryQrels.get(documentId) ?? 0) > 0).length;
  // trec_eval P.k always divides by k, even when the submitted run is shorter.
  return hits / k;
}

export function reciprocalRankAtK(
  run: readonly string[],
  queryQrels: QueryQrels,
  k: number,
): number {
  assertRanking(run);
  const index = run.slice(0, k).findIndex((documentId) => (queryQrels.get(documentId) ?? 0) > 0);
  return index < 0 ? 0 : 1 / (index + 1);
}

function mean(values: Array<number | null>): number {
  // trec_eval reports an all-zero effectiveness row for a query with no
  // documents above the relevance threshold. Keep that query in the macro
  // denominator even though the per-query ratio itself has no ideal divisor.
  return values.length === 0
    ? 0
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0) / values.length;
}

/** Queries present in qrels but missing from the run are evaluated as empty runs. */
export function evaluateRun(runs: RankedRuns, qrels: Qrels): QualityMetrics {
  const ndcg10: Array<number | null> = [];
  const map100: Array<number | null> = [];
  const recall100: Array<number | null> = [];
  const precision10: number[] = [];
  const mrr10: number[] = [];
  for (const [queryId, queryQrels] of qrels) {
    const run = runs.get(queryId) ?? [];
    ndcg10.push(ndcgAtK(run, queryQrels, 10));
    map100.push(averagePrecisionAtK(run, queryQrels, 100));
    recall100.push(recallAtK(run, queryQrels, 100));
    precision10.push(precisionAtK(run, queryQrels, 10));
    mrr10.push(reciprocalRankAtK(run, queryQrels, 10));
  }
  return {
    ndcg10: mean(ndcg10),
    map100: mean(map100),
    recall100: mean(recall100),
    precision10: mean(precision10),
    mrr10: mean(mrr10),
  };
}
