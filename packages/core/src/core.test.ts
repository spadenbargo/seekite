import { describe, expect, it } from "vite-plus/test";
import {
  createLexicalIndex,
  createSearch,
  decodeLexicalIndex,
  decodeVectors,
  encodeLexicalIndex,
  encodeVectors,
  searchLexical,
  type CorpusMetadata,
  type SearchManifest,
} from "./index.js";

describe("lexical index", () => {
  it("round-trips and ranks matching chunks", () => {
    const index = createLexicalIndex(["canvas drawing API", "authentication and users"]);
    const decoded = decodeLexicalIndex(encodeLexicalIndex(index));
    expect([...searchLexical(decoded, "canvas")]).toEqual([[0, expect.any(Number)]]);
  });

  it("handles object-prototype terms safely", () => {
    expect(() => createLexicalIndex(["constructor prototype"])).not.toThrow();
  });
});

describe("portable codecs", () => {
  it("round-trips little-endian vectors", () => {
    const vectors = [new Float32Array([0.25, -1.5]), new Float32Array([2, 3])];
    const encoded = encodeVectors(vectors, 2);
    const buffer = encoded.buffer.slice(
      encoded.byteOffset,
      encoded.byteOffset + encoded.byteLength,
    ) as ArrayBuffer;
    expect(decodeVectors(buffer, 2).map((vector) => [...vector])).toEqual(
      vectors.map((vector) => [...vector]),
    );
  });
});

describe("browser runtime", () => {
  it("accepts an explicit index URL and rejects ambiguous asset keys", async () => {
    const requested: string[] = [];
    const client = createSearch({
      url: "https://cdn.example.com/site-index/",
      fetch: async (input) => {
        requested.push(String(input));
        return new Response(
          JSON.stringify({
            format: "seekite",
            version: 1,
            generatedAt: "2026-01-01T00:00:00.000Z",
            corpora: {},
          }),
        );
      },
    });
    await expect(client.load("missing")).rejects.toThrow("Unknown Seekite corpus");
    expect(requested).toEqual(["https://cdn.example.com/site-index/manifest.json"]);
    expect(() => createSearch({ key: "/absolute" })).toThrow("relative asset path");
    expect(() => createSearch({ url: "relative/index" })).toThrow("use key");
  });

  it("loads one corpus and returns lexical results", async () => {
    const metadata: CorpusMetadata = {
      version: 1,
      name: "docs",
      chunks: [{ id: "a", documentId: "a", url: "/a", title: "Canvas", content: "Draw on canvas" }],
    };
    const manifest: SearchManifest = {
      format: "seekite",
      version: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      corpora: {
        docs: {
          name: "docs",
          path: "docs",
          chunks: 1,
          lexical: "lexical.bin",
          metadata: "metadata.json",
        },
      },
    };
    const lexical = encodeLexicalIndex(createLexicalIndex(["Canvas Draw on canvas"]));
    const lexicalBuffer = lexical.buffer.slice(
      lexical.byteOffset,
      lexical.byteOffset + lexical.byteLength,
    ) as ArrayBuffer;
    const assets = new Map<string, string | ArrayBuffer>([
      ["/search/manifest.json", JSON.stringify(manifest)],
      ["/search/docs/metadata.json", JSON.stringify(metadata)],
      ["/search/docs/lexical.bin", lexicalBuffer],
    ]);
    const client = createSearch({
      fetch: async (input) => {
        const body = assets.get(String(input));
        return body === undefined ? new Response(null, { status: 404 }) : new Response(body);
      },
    });
    const response = await client.query("canvas", { corpora: ["docs"], mode: "lexical" });
    expect(response.results[0]).toMatchObject({ corpus: "docs", title: "Canvas" });
    expect(response.total).toBe(1);
    expect(client.loaded()).toEqual(["docs"]);
  });

  it("lazily creates and caches runtime corpus vectors", async () => {
    const metadata: CorpusMetadata = {
      version: 1,
      name: "docs",
      chunks: [
        { id: "a", documentId: "a", url: "/a", title: "Canvas", content: "Drawing" },
        { id: "b", documentId: "b", url: "/b", title: "Login", content: "Authentication" },
      ],
    };
    const manifest: SearchManifest = {
      format: "seekite",
      version: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      corpora: {
        docs: {
          name: "docs",
          path: "docs",
          chunks: 2,
          lexical: "lexical.bin",
          metadata: "metadata.json",
          embedding: { provider: "test:2d", dimensions: 2, mode: "runtime" },
        },
      },
    };
    const lexical = encodeLexicalIndex(
      createLexicalIndex(["Canvas Drawing", "Login Authentication"]),
    );
    const lexicalBuffer = lexical.buffer.slice(
      lexical.byteOffset,
      lexical.byteOffset + lexical.byteLength,
    ) as ArrayBuffer;
    const assets = new Map<string, string | ArrayBuffer>([
      ["/search/manifest.json", JSON.stringify(manifest)],
      ["/search/docs/metadata.json", JSON.stringify(metadata)],
      ["/search/docs/lexical.bin", lexicalBuffer],
    ]);
    let documentEmbeddings = 0;
    const embeddings = {
      id: "test:2d",
      dimensions: 2,
      async embedDocuments() {
        documentEmbeddings += 1;
        return [new Float32Array([1, 0]), new Float32Array([0, 1])];
      },
      async embedQuery() {
        return new Float32Array([1, 0]);
      },
    };
    const client = createSearch({
      embeddings,
      fetch: async (input) => {
        const body = assets.get(String(input));
        return body === undefined ? new Response(null, { status: 404 }) : new Response(body);
      },
    });
    await client.load("docs");
    expect(documentEmbeddings).toBe(0);
    const first = await client.query("art", { corpora: ["docs"], mode: "semantic" });
    const second = await client.query("art", { corpora: ["docs"], mode: "semantic" });
    expect(first.results[0]?.title).toBe("Canvas");
    expect(second.results[0]?.title).toBe("Canvas");
    expect(documentEmbeddings).toBe(1);
  });
});
