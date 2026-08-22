import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { createDeterministicBaseline, writeBaseline } from "./baseline.js";
import { readRun } from "./runner.js";
import type { BenchRun } from "./types.js";

function runWithVolatileMetrics(seconds: number): BenchRun {
  return {
    version: 1,
    label: `run-${seconds}`,
    synthetic: false,
    createdAt: new Date(seconds * 1_000).toISOString(),
    config: {
      corpus: "docs",
      k: 10,
      candidates: { mini: { provider: "seekite:ternlight:mini:v1" } },
    },
    environment: {
      node: `node-${seconds}`,
      cpu: `cpu-${seconds}`,
      platform: `platform-${seconds}`,
      backend: "native",
      seekite: "0.1.0-alpha.0",
    },
    candidates: {
      mini: {
        quality: { hybrid: { recall: 1, mrr: 0.75, ndcg: 0.8 } },
        embed: { seconds, textsPerSec: 100 / seconds, backend: "native", cacheHits: 0.5 },
        query: { p50ms: seconds, p95ms: seconds * 2 },
        artifacts: {
          lexicalBytes: 10,
          vectorsBytes: 20,
          metadataBytes: 30,
          totalBytes: 60,
          gzip: { lexicalBytes: 5, vectorsBytes: 10, metadataBytes: 15, totalBytes: 30 },
        },
      },
    },
    perQuery: [{ query: "volatile detail", relevant: ["docs"], candidates: {} }],
  };
}

describe("benchmark baselines", () => {
  it("removes environment, latency, throughput, and per-query noise", () => {
    expect(createDeterministicBaseline(runWithVolatileMetrics(1))).toEqual(
      createDeterministicBaseline(runWithVolatileMetrics(20)),
    );
  });

  it("writes a stable, versioned baseline", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "seekite-baseline-"));
    const file = await writeBaseline(runWithVolatileMetrics(3), path.join(root, "baseline.json"));
    const baseline = await readRun(file);

    expect(baseline).toMatchObject({
      version: 1,
      label: "baseline",
      createdAt: "1970-01-01T00:00:00.000Z",
      environment: { node: "reference", backend: "reference" },
      candidates: {
        mini: {
          embed: { seconds: 0, textsPerSec: 0, backend: "reference", cacheHits: 0 },
          query: { p50ms: 0, p95ms: 0 },
        },
      },
      perQuery: [],
    });
  });
});
