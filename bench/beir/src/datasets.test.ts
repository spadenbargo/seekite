import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { DATASETS, loadDatasetDirectory } from "./datasets.js";

async function fixtureDirectory(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "seekite-beir-dataset-test-"));
  await mkdir(path.join(root, "qrels"));
  await Promise.all([
    writeFile(
      path.join(root, "corpus.jsonl"),
      [
        JSON.stringify({ _id: "d1", title: "First", text: "alpha" }),
        JSON.stringify({ _id: 2, text: "beta" }),
      ].join("\n"),
    ),
    writeFile(
      path.join(root, "queries.jsonl"),
      [
        JSON.stringify({ _id: "q1", text: "alpha query" }),
        JSON.stringify({ _id: "unjudged", text: "not evaluated" }),
        JSON.stringify({ _id: 2, text: "beta query" }),
      ].join("\n"),
    ),
    writeFile(
      path.join(root, "qrels", "test.tsv"),
      "query-id\tcorpus-id\tscore\nq1\td1\t2\n2\t2\t1\n",
    ),
  ]);
  return root;
}

describe("BEIR dataset definitions", () => {
  it("pins official HTTPS archives by byte length and SHA-256", () => {
    for (const [name, definition] of Object.entries(DATASETS)) {
      expect(definition.url).toBe(
        `https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/${name}.zip`,
      );
      expect(definition.archiveBytes).toBeGreaterThan(0);
      expect(definition.sha256).toMatch(/^[a-f\d]{64}$/);
    }
  });
});

describe("loadDatasetDirectory", () => {
  it("keeps title and text separate, filters unjudged queries, and preserves graded qrels", async () => {
    const loaded = await loadDatasetDirectory("scifact", await fixtureDirectory(), {
      validateExpectedCounts: false,
    });

    expect(loaded.documents).toEqual([
      { id: "d1", title: "First", text: "alpha" },
      { id: "2", title: "", text: "beta" },
    ]);
    expect(loaded.queries).toEqual([
      { id: "q1", text: "alpha query" },
      { id: "2", text: "beta query" },
    ]);
    expect(loaded.qrels.get("q1")?.get("d1")).toBe(2);
  });

  it("preserves official qrels even when a judged id is absent from the corpus", async () => {
    const root = await fixtureDirectory();
    await writeFile(
      path.join(root, "qrels", "test.tsv"),
      "query-id\tcorpus-id\tscore\nq1\tmissing\t1\n",
    );

    const loaded = await loadDatasetDirectory("scifact", root, {
      validateExpectedCounts: false,
    });
    expect(loaded.qrels.get("q1")?.get("missing")).toBe(1);
  });
});
