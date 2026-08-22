import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { decodeVectorsV2, vectorSimilarity, type EmbeddingProvider } from "@seekite/core";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  clearEmbeddingCache,
  embedDocumentsCached,
  embeddingCacheKey,
  getEmbeddingCacheStats,
  pruneEmbeddingCache,
  sanitizeProviderId,
  xxhash64Fallback,
} from "./cache.js";
import { buildSearch } from "./build.js";
import { defineSource, staticVectors } from "./types.js";

const temporaryDirectories: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "seekite-cache-test-"));
  temporaryDirectories.push(root);
  return root;
}

function deterministicProvider(
  id: string,
  dimensions = 2,
): EmbeddingProvider & { calls: string[][] } {
  const calls: string[][] = [];
  const vector = (text: string) =>
    Float32Array.from(
      { length: dimensions },
      (_, index) => (text.codePointAt(index) ?? text.length) / 100,
    );
  return {
    id,
    dimensions,
    calls,
    async embedDocuments(texts) {
      calls.push([...texts]);
      return texts.map(vector);
    },
    async embedQuery(text) {
      return vector(text);
    },
  };
}

function providerDirectory(root: string, provider: string): string {
  return path.join(root, ".seekite/cache/embeddings", sanitizeProviderId(provider));
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("xxhash64 fallback", () => {
  it("matches canonical vectors and the optional native implementation", async () => {
    expect(xxhash64Fallback("")).toBe(0xef46db3751d8e999n);
    expect(xxhash64Fallback("seekite\0cache")).toBe(0x9a107f0c171a5801n);
    const native = await import("../../engine-native/src/index.js");
    if (native.isSupported()) {
      expect(xxhash64Fallback("héllo 🔍")).toBe(native.xxhash64("héllo 🔍"));
      for (let length = 0; length <= 96; length += 1) {
        const bytes = Uint8Array.from({ length }, (_, index) => (index * 31 + length) & 0xff);
        expect(xxhash64Fallback(bytes), `length ${length}`).toBe(native.xxhash64(bytes));
      }
    }
    expect(await embeddingCacheKey("provider:v1", "same text")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("embedding cache", () => {
  it("batches unique misses, preserves order, then serves only hits", async () => {
    const root = await temporaryRoot();
    const provider = deterministicProvider("test:order:v1");
    const first = await embedDocumentsCached(provider, ["beta", "alpha", "beta"], { root });
    expect(first).toMatchObject({ cached: 0, embedded: 2 });
    expect(provider.calls).toEqual([["beta", "alpha"]]);
    expect([...(first.vectors[0] ?? [])]).toEqual([...(first.vectors[2] ?? [])]);

    // The documented v1 shape has only version/dimensions/entries. Metadata
    // added by newer writers must remain optional when an older cache is read.
    const indexPath = path.join(providerDirectory(root, provider.id), "index.json");
    const written = JSON.parse(await readFile(indexPath, "utf8")) as {
      version: 1;
      dimensions: number;
      entries: Record<string, number>;
    };
    await writeFile(
      indexPath,
      `${JSON.stringify({ version: written.version, dimensions: written.dimensions, entries: written.entries })}\n`,
    );

    const second = await embedDocumentsCached(provider, ["alpha", "beta"], { root });
    expect(second).toMatchObject({ cached: 2, embedded: 0 });
    expect(provider.calls).toHaveLength(1);
    expect([...(second.vectors[0] ?? [])]).toEqual([...(first.vectors[1] ?? [])]);
  });

  it("keeps an interrupted append invisible and prune compacts the orphan row", async () => {
    const root = await temporaryRoot();
    const provider = deterministicProvider("test:interrupted:v1");
    await embedDocumentsCached(provider, ["one"], { root });
    const vectorsPath = path.join(providerDirectory(root, provider.id), "vectors.bin");
    await appendFile(vectorsPath, Buffer.alloc(provider.dimensions * 4, 0x7f));

    const resolved = await embedDocumentsCached(provider, ["one", "two"], { root });
    expect(resolved).toMatchObject({ cached: 1, embedded: 1 });
    expect((await readFile(vectorsPath)).byteLength).toBe(24);

    const pruned = await pruneEmbeddingCache({ root });
    expect(pruned).toMatchObject({ bytesBefore: 24, bytesAfter: 16 });
    expect(await getEmbeddingCacheStats({ root })).toMatchObject({ entries: 2, bytes: 16 });
  });

  it("discards a provider directory after a dimensions mismatch", async () => {
    const root = await temporaryRoot();
    const original = deterministicProvider("test:dimensions:v1", 2);
    await embedDocumentsCached(original, ["one"], { root });
    const changed = deterministicProvider(original.id, 3);
    const warnings: string[] = [];
    const result = await embedDocumentsCached(changed, ["one"], {
      root,
      onWarning: (warning) => warnings.push(warning),
    });
    expect(result).toMatchObject({ cached: 0, embedded: 1 });
    expect(warnings.join(" ")).toContain("dimension mismatch");
    expect((await getEmbeddingCacheStats({ root })).providers[0]).toMatchObject({
      dimensions: 3,
      entries: 1,
      bytes: 12,
    });
  });

  it("recovers from a corrupt index and from missing referenced rows", async () => {
    const root = await temporaryRoot();
    const provider = deterministicProvider("test:corrupt:v1");
    await embedDocumentsCached(provider, ["one"], { root });
    const directory = providerDirectory(root, provider.id);
    const warnings: string[] = [];
    await appendFile(path.join(directory, "vectors.bin"), Buffer.alloc(3, 0xff));
    const repairedTail = await embedDocumentsCached(provider, ["one"], {
      root,
      onWarning: (warning) => warnings.push(warning),
    });
    expect(repairedTail).toMatchObject({ cached: 1, embedded: 0 });
    expect(warnings.join(" ")).toContain("incomplete row");
    expect((await readFile(path.join(directory, "vectors.bin"))).byteLength).toBe(8);

    await writeFile(path.join(directory, "index.json"), "{not-json");
    warnings.length = 0;
    const result = await embedDocumentsCached(provider, ["one"], {
      root,
      onWarning: (warning) => warnings.push(warning),
    });
    expect(result).toMatchObject({ cached: 0, embedded: 1 });
    expect(warnings.join(" ")).toContain("corrupt");

    const index = JSON.parse(await readFile(path.join(directory, "index.json"), "utf8")) as {
      entries: Record<string, number>;
    };
    const key = Object.keys(index.entries)[0];
    expect(key).toBeDefined();
    if (key) index.entries[key] = 99;
    await writeFile(path.join(directory, "index.json"), `${JSON.stringify(index)}\n`);
    warnings.length = 0;
    const recovered = await embedDocumentsCached(provider, ["one"], {
      root,
      onWarning: (warning) => warnings.push(warning),
    });
    expect(recovered).toMatchObject({ cached: 0, embedded: 1 });
    expect(warnings.join(" ")).toContain("missing row");
  });

  it("bypasses reads but still warms the cache", async () => {
    const root = await temporaryRoot();
    const provider = deterministicProvider("test:warm:v1");
    await embedDocumentsCached(provider, ["one", "two"], { root });
    const bypassed = await embedDocumentsCached(provider, ["one", "two"], { root, read: false });
    expect(bypassed).toMatchObject({ cached: 0, embedded: 2 });
    const warmed = await embedDocumentsCached(provider, ["one", "two"], { root });
    expect(warmed).toMatchObject({ cached: 2, embedded: 0 });
    expect(provider.calls).toHaveLength(2);
  });

  it("serializes concurrent builds sharing a provider cache", async () => {
    const root = await temporaryRoot();
    const provider = deterministicProvider("test:concurrent:v1");
    const embed = provider.embedDocuments.bind(provider);
    provider.embedDocuments = async (texts) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return embed(texts);
    };
    const [first, second] = await Promise.all([
      embedDocumentsCached(provider, ["one", "two"], { root }),
      embedDocumentsCached(provider, ["one", "two"], { root }),
    ]);
    expect(first.embedded + second.embedded).toBe(2);
    expect(first.cached + second.cached).toBe(2);
    expect(provider.calls).toHaveLength(1);
  });

  it("reports stats, evicts oldest rows to a size budget, and clears providers", async () => {
    const root = await temporaryRoot();
    const provider = deterministicProvider("test:management:v1");
    await embedDocumentsCached(provider, ["one", "two", "three"], { root });
    expect(await getEmbeddingCacheStats({ root })).toMatchObject({ entries: 3, bytes: 24 });
    const pruned = await pruneEmbeddingCache({ root, maxSize: 16 });
    expect(pruned.entriesRemoved).toBe(1);
    expect(await getEmbeddingCacheStats({ root })).toMatchObject({ entries: 2, bytes: 16 });
    expect(await clearEmbeddingCache({ root, provider: provider.id })).toMatchObject({
      providersRemoved: 1,
      bytesRemoved: 16,
    });
    expect((await getEmbeddingCacheStats({ root })).providers).toEqual([]);
  });
});

describe("build cache integration", () => {
  it("makes a warm build byte-identical and re-embeds only a changed source", async () => {
    const root = await temporaryRoot();
    await writeFile(path.join(root, "one.md"), "One\n# Intro\nFirst unchanged page.");
    await writeFile(
      path.join(root, "two.md"),
      "Two\n# Configure\nSecond page.\n## Deploy\nDeployment details.",
    );
    const provider = deterministicProvider("test:build:v1");
    const source = defineSource("test-files", async (context) =>
      Promise.all(
        ["one", "two"].map(async (name) => {
          const [title = name, ...body] = (
            await readFile(path.join(context.root, `${name}.md`), "utf8")
          ).split("\n");
          return { id: name, url: `/${name}`, title, content: body.join("\n") };
        }),
      ),
    );
    const config = {
      corpora: {
        docs: { source, vectors: staticVectors(provider) },
      },
    };

    const first = await buildSearch(config, { root, outputDir: "search" });
    const firstVectors = await readFile(path.join(root, "search/docs/vectors.bin"));
    expect(first.corpora.docs).toMatchObject({ chunks: 3, cached: 0, embedded: 3 });

    const second = await buildSearch(config, { root, outputDir: "search" });
    const secondVectors = await readFile(path.join(root, "search/docs/vectors.bin"));
    expect(second.corpora.docs).toMatchObject({ cached: 3, embedded: 0 });
    expect(secondVectors.equals(firstVectors)).toBe(true);
    expect(provider.calls).toHaveLength(1);

    await writeFile(
      path.join(root, "two.md"),
      "Two updated\n# Configure\nSecond page.\n## Deploy\nDeployment details.",
    );
    const third = await buildSearch(config, { root, outputDir: "search" });
    expect(third.corpora.docs).toMatchObject({ cached: 1, embedded: 2 });
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]).toHaveLength(2);
  });

  it("honours cache flags and cache-directory environment overrides", async () => {
    const root = await temporaryRoot();
    const cacheDir = path.join(root, "mounted-cache");
    vi.stubEnv("SEEKITE_CACHE_DIR", cacheDir);
    const provider = deterministicProvider("test:environment:v1");
    const config = {
      corpora: {
        docs: {
          source: [{ id: "one", url: "/one", title: "One", content: "Environment cache" }],
          vectors: staticVectors(provider),
        },
      },
    };
    await buildSearch(config, { root, outputDir: "search" });
    const bypassed = await buildSearch(config, { root, outputDir: "search", cache: false });
    expect(bypassed.corpora.docs).toMatchObject({ cached: 0, embedded: 1 });
    expect((await getEmbeddingCacheStats({ cacheDir })).entries).toBe(1);

    vi.stubEnv("SEEKITE_NO_CACHE", "1");
    const environmentBypass = await buildSearch(config, { root, outputDir: "search" });
    expect(environmentBypass.corpora.docs).toMatchObject({ cached: 0, embedded: 1 });
  });

  it("reuses the same float cache rows for i8 and f32 output quantization", async () => {
    const root = await temporaryRoot();
    const provider = deterministicProvider("test:quantization:v1", 3);
    const source = [
      { id: "one", url: "/one", title: "One", content: "Quantize only at serialization" },
    ];

    await buildSearch(
      { corpora: { docs: { source, vectors: staticVectors(provider, { quantize: "i8" }) } } },
      { root, outputDir: "search-i8" },
    );
    const warm = await buildSearch(
      { corpora: { docs: { source, vectors: staticVectors(provider, { quantize: "f32" }) } } },
      { root, outputDir: "search-f32" },
    );

    expect(warm.corpora.docs).toMatchObject({ cached: 1, embedded: 0 });
    expect(provider.calls).toHaveLength(1);
    const i8 = decodeVectorsV2(await readFile(path.join(root, "search-i8/docs/vectors.bin")), 3);
    const f32 = decodeVectorsV2(await readFile(path.join(root, "search-f32/docs/vectors.bin")), 3);
    expect(i8.dtype).toBe("i8");
    expect(f32.dtype).toBe("f32");
    const exact = Float32Array.from(f32.values.slice(0, 3));
    expect(vectorSimilarity(f32, 0, exact)).toBeCloseTo(1, 6);
    expect(vectorSimilarity(i8, 0, exact)).toBeGreaterThan(0.999);
  });
});
