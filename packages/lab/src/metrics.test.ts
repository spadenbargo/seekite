import { describe, expect, it } from "vite-plus/test";
import { compareRuns } from "./compare.js";
import { meanQuality, ndcgAtK, recallAtK, reciprocalRankAtK } from "./metrics.js";
import { generateSyntheticQueries } from "./synthetic.js";
import type { BenchRun } from "./types.js";

function comparisonRun(ndcg: number): BenchRun {
  return {
    version: 1,
    label: "fixture",
    synthetic: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    config: { corpus: "docs", k: 10, candidates: {} },
    environment: {
      node: "test",
      cpu: "test",
      platform: "test",
      backend: "test",
      seekite: "0.1.0-alpha.0",
    },
    candidates: {
      mini: {
        quality: { hybrid: { recall: 1, mrr: 1, ndcg } },
        embed: { seconds: 0, textsPerSec: 0, backend: "test", cacheHits: 0 },
        query: { p50ms: 0, p95ms: 0 },
        artifacts: {
          lexicalBytes: 0,
          vectorsBytes: 0,
          metadataBytes: 0,
          totalBytes: 0,
          gzip: { lexicalBytes: 0, vectorsBytes: 0, metadataBytes: 0, totalBytes: 0 },
        },
      },
    },
    perQuery: [],
  };
}

describe("quality metrics", () => {
  it("matches hand-computed binary relevance metrics", () => {
    const hits = ["irrelevant", "a", "b", "c"];
    expect(recallAtK(hits, ["a", "b"], 3)).toBe(1);
    expect(reciprocalRankAtK(hits, ["a", "b"], 3)).toBe(0.5);
    expect(ndcgAtK(hits, ["a", "b"], 3)).toBeCloseTo(
      (1 / Math.log2(3) + 1 / Math.log2(4)) / (1 + 1 / Math.log2(3)),
    );
    expect(
      meanQuality([
        { recall: 1, mrr: 0.5, ndcg: 0.75 },
        { recall: 0, mrr: 0, ndcg: 0 },
      ]),
    ).toEqual({ recall: 0.5, mrr: 0.25, ndcg: 0.375 });
  });
});

describe("synthetic eval generation", () => {
  const chunks = [
    {
      id: "b",
      documentId: "doc-b",
      title: "Authentication",
      heading: "Configure OAuth",
      content: "Set the callback credential and redirect address.",
    },
    {
      id: "a",
      documentId: "doc-a",
      title: "Canvas guide",
      heading: "Draw shapes",
      content: "Render a rectangle with the drawing context.",
    },
  ];

  it("is deterministic and labels generated judgments", () => {
    const first = generateSyntheticQueries(chunks, { seed: 7 });
    expect(generateSyntheticQueries(chunks, { seed: 7 })).toEqual(first);
    expect(first).toMatchInlineSnapshot(`
      [
        {
          "query": "Configure OAuth",
          "relevant": [
            "doc-b",
          ],
          "synthetic": true,
        },
        {
          "query": "Authentication address",
          "relevant": [
            "doc-b",
          ],
          "synthetic": true,
        },
        {
          "query": "dadress",
          "relevant": [
            "doc-b",
          ],
          "synthetic": true,
        },
        {
          "query": "Draw shapes",
          "relevant": [
            "doc-a",
          ],
          "synthetic": true,
        },
        {
          "query": "Canvas guide context",
          "relevant": [
            "doc-a",
          ],
          "synthetic": true,
        },
        {
          "query": "contetx",
          "relevant": [
            "doc-a",
          ],
          "synthetic": true,
        },
      ]
    `);
  });
});

describe("run comparison", () => {
  it("fails only when NDCG drops beyond tolerance", () => {
    expect(compareRuns(comparisonRun(0.9), comparisonRun(0.895)).passed).toBe(true);
    expect(compareRuns(comparisonRun(0.9), comparisonRun(0.88)).passed).toBe(false);

    const missing = comparisonRun(0.9);
    delete missing.candidates.mini;
    expect(compareRuns(comparisonRun(0.9), missing).passed).toBe(false);
  });
});
