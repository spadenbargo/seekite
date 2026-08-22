import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSearch, decodeVectorsV2 } from "@seekite/core";
import { describe, expect, it } from "vite-plus/test";
import {
  buildSearch,
  chunkDocument,
  defineSource,
  runtimeVectors,
  staticVectors,
} from "./index.js";

const embeddings = {
  id: "test:2d",
  dimensions: 2,
  async embedDocuments(documents: string[]) {
    return documents.map(() => new Float32Array([1, 0]));
  },
  async embedQuery() {
    return new Float32Array([1, 0]);
  },
};

describe("build pipeline", () => {
  it("chunks headings independently", () => {
    const chunks = chunkDocument(
      {
        id: "guide",
        url: "/guide",
        title: "Guide",
        content: "# Install\nUse pnpm.\n## Configure\nCreate a config.",
      },
      { maxWords: 20 },
    );
    expect(chunks.map((chunk) => chunk.heading)).toEqual(["Install", "Configure"]);
  });

  it("writes an independently loadable corpus", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "seekite-"));
    const result = await buildSearch(
      {
        corpora: {
          docs: {
            source: [
              { id: "one", url: "/docs/one", title: "One", content: "Local search works offline." },
            ],
          },
        },
      },
      { root, outputDir: "search" },
    );
    expect(result.corpora.docs).toEqual({ documents: 1, chunks: 1 });
    const manifest = JSON.parse(await readFile(path.join(root, "search/manifest.json"), "utf8"));
    expect(manifest.version).toBe(2);
    expect(manifest.corpora.docs.path).toBe("docs");
    expect(manifest.corpora.docs).toMatchObject({
      format: 2,
      corpus: "corpus.json",
      lexical: { dictionary: "lexical/dictionary.bin" },
      content: { prefix: "content/content-" },
    });
  });

  it("writes static vectors during the build", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "seekite-static-"));
    await buildSearch(
      {
        corpora: {
          docs: {
            source: [{ id: "one", url: "/one", title: "One", content: "Static vectors" }],
            vectors: staticVectors(embeddings),
          },
        },
      },
      { root, outputDir: "search" },
    );
    const manifest = JSON.parse(await readFile(path.join(root, "search/manifest.json"), "utf8"));
    expect(manifest.corpora.docs).toMatchObject({
      vectors: { file: "vectors.bin", dtype: "i8" },
      embedding: { provider: "test:2d", dimensions: 2, mode: "static" },
    });
    const vectorFile = await readFile(path.join(root, "search/docs/vectors.bin"));
    const decoded = decodeVectorsV2(vectorFile, 2);
    expect(decoded).toMatchObject({ version: 2, dtype: "i8", dimensions: 2, count: 1 });
  });

  it("defers runtime vectors and accepts a developer-owned async source", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "seekite-runtime-"));
    let loadedFrom = "";
    const source = defineSource("api", async (context) => {
      loadedFrom = context.root;
      return [{ id: "one", url: "/one", title: "One", content: "Runtime vectors" }];
    });
    const config = {
      corpora: { docs: { source, vectors: runtimeVectors(embeddings) } },
    } as const;
    await buildSearch(
      {
        corpora: { docs: { source, vectors: staticVectors(embeddings) } },
      },
      { root, outputDir: "search" },
    );
    await buildSearch(config, { root, outputDir: "search" });
    const manifest = JSON.parse(await readFile(path.join(root, "search/manifest.json"), "utf8"));
    expect(loadedFrom).toBe(root);
    expect(manifest.corpora.docs).toMatchObject({
      embedding: { provider: "test:2d", dimensions: 2, mode: "runtime" },
    });
    expect(manifest.corpora.docs.vectors).toBeUndefined();
    await expect(readFile(path.join(root, "search/docs/vectors.bin"))).rejects.toThrow();
  });

  it("writes filter columns, facets, lazy content, and the temporary v1 escape hatch", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "seekite-formats-"));
    const source = [
      {
        id: "one",
        url: "/one",
        title: "Café guide",
        content: "# Configure\nLocal search.",
        metadata: { tags: ["vite"], version: "2.x", author: "Ada" },
      },
    ];
    await buildSearch(
      {
        corpora: { docs: { source, filters: ["version"], facets: ["tags"], lang: "en" } },
      },
      { root, outputDir: "search" },
    );
    const corpus = JSON.parse(await readFile(path.join(root, "search/docs/corpus.json"), "utf8"));
    const content = JSON.parse(
      await readFile(path.join(root, "search/docs/content/content-000.json"), "utf8"),
    );
    expect(corpus).toMatchObject({
      version: 2,
      chunks: { filters: { version: ["2.x"], tags: [["vite"]] } },
      facets: { tags: { vite: 1 } },
    });
    expect(content.chunks[0]).toMatchObject({
      content: "Local search.",
      metadata: { author: "Ada" },
    });

    await buildSearch({ corpora: { docs: { source } } }, { root, outputDir: "search", format: 1 });
    const manifest = JSON.parse(await readFile(path.join(root, "search/manifest.json"), "utf8"));
    expect(manifest.version).toBe(1);
    expect(manifest.corpora.docs).toMatchObject({
      lexical: "lexical.bin",
      metadata: "metadata.json",
    });
    await expect(readFile(path.join(root, "search/docs/corpus.json"))).rejects.toThrow();
  });

  it("loads format v1 and v2 artifacts with the same ranking", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "seekite-format-parity-"));
    const source = [
      {
        id: "canvas",
        url: "/canvas",
        title: "Canvas drawing",
        content: "Draw shapes with the canvas API.",
      },
      {
        id: "authentication",
        url: "/authentication",
        title: "Authentication",
        content: "Configure users and login providers.",
      },
      {
        id: "deployment",
        url: "/deployment",
        title: "Deployment",
        content: "Publish static assets to a CDN.",
      },
    ];
    await buildSearch(
      { corpora: { docs: { source } } },
      { root, outputDir: "search-v1", format: 1 },
    );
    await buildSearch(
      { corpora: { docs: { source } } },
      { root, outputDir: "search-v2", format: 2 },
    );

    const client = (directory: string) =>
      createSearch({
        url: `https://seekite.test/${directory}/`,
        fetch: async (input) => {
          const request = new URL(String(input));
          try {
            const body = await readFile(path.join(root, request.pathname));
            return new Response(body);
          } catch {
            return new Response(null, { status: 404 });
          }
        },
      });
    const [v1, v2] = await Promise.all([
      client("search-v1").query("canvas", { mode: "lexical" }),
      client("search-v2").query("canvas", { mode: "lexical" }),
    ]);

    expect(v1.results.map((result) => result.documentId)).toEqual(
      v2.results.map((result) => result.documentId),
    );
  });
});
