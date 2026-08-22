import type { EvalJudgment, QualityMetrics } from "./types.js";

function relevanceAt(hits: string[], relevant: Set<string>, k: number): number[] {
  return hits.slice(0, k).map((hit) => (relevant.has(hit) ? 1 : 0));
}

export function recallAtK(hits: string[], relevantValues: Iterable<string>, k: number): number {
  const relevant = new Set(relevantValues);
  if (relevant.size === 0) return 0;
  return relevanceAt(hits, relevant, k).reduce((sum, value) => sum + value, 0) / relevant.size;
}

export function reciprocalRankAtK(
  hits: string[],
  relevantValues: Iterable<string>,
  k: number,
): number {
  const relevant = new Set(relevantValues);
  const index = hits.slice(0, k).findIndex((hit) => relevant.has(hit));
  return index < 0 ? 0 : 1 / (index + 1);
}

export function ndcgAtK(hits: string[], relevantValues: Iterable<string>, k: number): number {
  const relevant = new Set(relevantValues);
  if (relevant.size === 0) return 0;
  const gains = relevanceAt(hits, relevant, k);
  const dcg = gains.reduce((sum, gain, index) => sum + gain / Math.log2(index + 2), 0);
  const idealCount = Math.min(k, relevant.size);
  let ideal = 0;
  for (let index = 0; index < idealCount; index += 1) ideal += 1 / Math.log2(index + 2);
  return dcg / ideal;
}

export function qualityForQuery(hits: string[], judgment: EvalJudgment, k: number): QualityMetrics {
  return {
    recall: recallAtK(hits, judgment.relevant, k),
    mrr: reciprocalRankAtK(hits, judgment.relevant, k),
    ndcg: ndcgAtK(hits, judgment.relevant, k),
  };
}

export function meanQuality(values: QualityMetrics[]): QualityMetrics {
  if (values.length === 0) return { recall: 0, mrr: 0, ndcg: 0 };
  const total = values.reduce<QualityMetrics>(
    (sum, value) => ({
      recall: sum.recall + value.recall,
      mrr: sum.mrr + value.mrr,
      ndcg: sum.ndcg + value.ndcg,
    }),
    { recall: 0, mrr: 0, ndcg: 0 },
  );
  return {
    recall: total.recall / values.length,
    mrr: total.mrr / values.length,
    ndcg: total.ndcg / values.length,
  };
}
