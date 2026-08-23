import { describe, expect, it } from "vite-plus/test";
import {
  averagePrecisionAtK,
  evaluateRun,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  reciprocalRankAtK,
} from "./metrics.js";

describe("trec_eval-compatible metrics", () => {
  const graded = new Map([
    ["a", 3],
    ["b", 2],
    ["c", 1],
    ["irrelevant-judged", 0],
  ]);
  const run = ["b", "unjudged", "a", "c"];

  it("uses linear graded gain for nDCG", () => {
    const dcg = 2 + 3 / Math.log2(4) + 1 / Math.log2(5);
    const ideal = 3 + 2 / Math.log2(3) + 1 / Math.log2(4);
    expect(ndcgAtK(run, graded, 4)).toBeCloseTo(dcg / ideal, 12);
  });

  it("uses every relevant qrel in the MAP denominator", () => {
    expect(averagePrecisionAtK(run, graded, 3)).toBeCloseTo((1 + 2 / 3) / 3, 12);
  });

  it("uses binary relevance for recall, precision, and reciprocal rank", () => {
    expect(recallAtK(run, graded, 3)).toBeCloseTo(2 / 3, 12);
    expect(precisionAtK(run, graded, 3)).toBeCloseTo(2 / 3, 12);
    expect(precisionAtK(["b"], graded, 10)).toBe(0.1);
    expect(reciprocalRankAtK(["x", "y", "c"], graded, 10)).toBeCloseTo(1 / 3, 12);
  });

  it("returns null for metrics whose ideal set has no relevant documents", () => {
    const noRelevant = new Map([["a", 0]]);
    expect(ndcgAtK(["a"], noRelevant, 10)).toBeNull();
    expect(averagePrecisionAtK(["a"], noRelevant, 100)).toBeNull();
    expect(recallAtK(["a"], noRelevant, 100)).toBeNull();
    expect(precisionAtK(["a"], noRelevant, 10)).toBe(0);
    expect(reciprocalRankAtK(["a"], noRelevant, 10)).toBe(0);
  });

  it("scores missing query runs as empty and macro-averages per query", () => {
    const qrels = new Map([
      ["q1", new Map([["a", 1]])],
      ["q2", new Map([["b", 1]])],
    ]);
    const metrics = evaluateRun(new Map([["q1", ["a"]]]), qrels);
    expect(metrics).toEqual({
      ndcg10: 0.5,
      map100: 0.5,
      recall100: 0.5,
      precision10: 0.05,
      mrr10: 0.5,
    });
  });

  it("keeps a query with no positive qrels in the macro denominator as zero", () => {
    const qrels = new Map([
      ["q1", new Map([["a", 1]])],
      ["q2", new Map([["judged-but-not-relevant", 0]])],
    ]);
    const metrics = evaluateRun(new Map([["q1", ["a"]]]), qrels);
    expect(metrics.ndcg10).toBe(0.5);
    expect(metrics.map100).toBe(0.5);
    expect(metrics.recall100).toBe(0.5);
  });

  it("rejects duplicate document ids instead of double-counting them", () => {
    expect(() => precisionAtK(["a", "a"], graded, 10)).toThrow("duplicate document ids");
  });
});
