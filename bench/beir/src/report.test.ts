import { describe, expect, it } from "vite-plus/test";
import {
  evaluateChecks,
  formatMarkdown,
  type AcceptedResults,
  type BenchmarkReport,
} from "./report.js";

function report(ndcg10 = 0.6): BenchmarkReport {
  return {
    benchmark: "beir-search-quality",
    createdAt: "2026-08-23T00:00:00.000Z",
    datasets: {
      scifact: {
        archive: { bytes: 1, sha256: "a".repeat(64) },
        documents: 1,
        queries: 1,
        referenceBm25Ndcg10: 0.665,
        engines: {
          "seekite-lexical": {
            candidate: "lexical",
            engine: "seekite",
            key: "seekite-lexical",
            label: "Seekite (lexical)",
            metrics: {
              ndcg10,
              map100: 0.5,
              recall100: 0.5,
              precision10: 0.1,
              mrr10: 0.5,
            },
            timing: {
              budgetMs: 300_000,
              buildSeconds: 1,
              completedQueries: 1,
              msPerQuery: 2,
              queryMilliseconds: 2,
              queries: 1,
              status: "completed",
            },
          },
        },
      },
    },
    engineBudgetMs: 300_000,
    environment: {
      cpu: { cores: 1, model: "fixture CPU" },
      git: { dirty: false, revision: "abc" },
      host: "fixture",
      memory: { freeBytesAtStart: 1, totalBytes: 2 },
      node: "v24.0.0",
      packages: {},
      platform: "test",
      v8: "test",
    },
    macro: {},
    metricDefinitions: {
      ndcg10: "n",
      map100: "m",
      recall100: "r",
      precision10: "p",
      mrr10: "mrr",
    },
    retrievalLimit: 100,
    selection: { candidates: ["lexical"], datasets: ["scifact"], engines: ["seekite"] },
    version: 1,
  };
}

const pending: AcceptedResults = {
  acceptedAt: null,
  datasets: {},
  regressionTolerance: 0.02,
  version: 1,
};

describe("evaluateChecks", () => {
  it("runs the sanity guard while marking an empty reviewed baseline honestly", () => {
    expect(evaluateChecks(report(), pending)).toMatchObject({
      passed: true,
      regression: "not-evaluated",
      sanity: "passed",
    });
  });

  it("fails below the Lucene reference minus the sanity tolerance", () => {
    const result = evaluateChecks(report(0.5), pending);
    expect(result.passed).toBe(false);
    expect(result.issues[0]).toMatchObject({ kind: "sanity", minimum: 0.515 });
  });

  it("fails an nDCG regression greater than the accepted tolerance", () => {
    const accepted: AcceptedResults = {
      ...pending,
      acceptedAt: "2026-08-23T00:00:00.000Z",
      datasets: { scifact: { "seekite-lexical": { ndcg10: 0.63 } } },
    };
    const result = evaluateChecks(report(0.6), accepted);
    expect(result.regression).toBe("failed");
    expect(result.issues).toContainEqual(
      expect.objectContaining({ kind: "regression", baseline: 0.63, minimum: 0.61 }),
    );
  });
});

it("formats aggregate values without query or corpus text", () => {
  const value = report();
  value.macro = {
    "seekite-lexical": {
      datasets: 1,
      label: "Seekite (lexical)",
      metrics: value.datasets.scifact!.engines["seekite-lexical"]!.metrics,
      msPerQuery: 2,
    },
  };
  const markdown = formatMarkdown(value);
  expect(markdown).toContain("| Seekite (lexical) | 0.600");
  expect(markdown).not.toContain("query text");
});
