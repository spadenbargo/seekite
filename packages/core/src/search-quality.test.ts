import { describe, expect, it } from "vite-plus/test";
import {
  SeekiteFormatError,
  analyze,
  analyzeQuery,
  boundedLevenshtein,
  createLexicalIndexV2,
  createSearch,
  decodeDictionaryV2,
  dictionaryPrefixRange,
  encodeLexicalV2,
  expandQueryTerms,
  fold,
  highlightRanges,
  scoreLexicalV2,
  snippet,
  stemEnglish,
  type CorpusMetadataV2,
  type SearchManifestV2,
} from "./index.js";

const analyzer = { folding: true, stemmer: null } as const;

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function fullDistance(left: string, right: string): number {
  const rows = Array.from({ length: left.length + 1 }, () =>
    Array.from<number>({ length: right.length + 1 }).fill(0),
  );
  for (let index = 0; index <= left.length; index += 1) rows[index]![0] = index;
  for (let index = 0; index <= right.length; index += 1) rows[0]![index] = index;
  for (let l = 1; l <= left.length; l += 1)
    for (let r = 1; r <= right.length; r += 1) {
      rows[l]![r] = Math.min(
        rows[l - 1]![r]! + 1,
        rows[l]![r - 1]! + 1,
        rows[l - 1]![r - 1]! + (left[l - 1] === right[r - 1] ? 0 : 1),
      );
    }
  return rows[left.length]![right.length]!;
}

describe("analysis and expansion", () => {
  it("uses an idempotent analyzer for both build terms and query terms", () => {
    const english = { folding: true, stemmer: "en" } as const;
    const text = "Crème configuring connections";
    const analyzed = analyze(text, english);
    expect(analyze(analyzed.join(" "), english)).toEqual(analyzed);

    const index = createLexicalIndexV2(
      [{ title: "Crème", heading: "Configuring", content: "Connections" }],
      english,
    );
    const dictionary = decodeDictionaryV2(encodeLexicalV2(index).dictionary);
    const queryTerms = analyzeQuery(`${text} `, english);
    expect(queryTerms.every((token) => !token.prefix)).toBe(true);
    expect(dictionary.terms.map((term) => term.term)).toEqual(
      [...new Set(queryTerms.map((token) => token.term))].toSorted(),
    );
    expect(
      expandQueryTerms(dictionary.terms, `${text} `, english).every(
        (term) => term.kind === "exact",
      ),
    ).toBe(true);
  });

  it("folds diacritics and applies the English stemmer", () => {
    expect(fold("Crème BRÛLÉE")).toBe("creme brulee");
    expect(stemEnglish("configuring")).toBe("configur");
    expect(stemEnglish("connections")).toBe("connect");
  });

  it("finds prefix ranges including unicode terms", () => {
    const terms = ["auth", "authentication", "authorize", "café", "čaj", "zebra"];
    const [start, end] = dictionaryPrefixRange(terms, "auth");
    expect(terms.slice(start, end)).toEqual(["auth", "authentication", "authorize"]);
  });

  it("matches bounded Levenshtein against brute force", () => {
    const words = [
      "tolerance",
      "tolarance",
      "search",
      "saerch",
      "semantic",
      "semntic",
      "cat",
      "cut",
    ];
    for (const left of words)
      for (const right of words)
        for (const maximum of [0, 1, 2]) {
          const expected = fullDistance(left, right);
          expect(boundedLevenshtein(left, right, maximum)).toBe(
            expected <= maximum ? expected : undefined,
          );
        }

    let state = 0x5ee517e;
    const random = () => (state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0);
    const word = () =>
      Array.from({ length: 1 + (random() % 10) }, () =>
        String.fromCharCode(97 + (random() % 6)),
      ).join("");
    for (let index = 0; index < 200; index += 1) {
      const left = word();
      const right = word();
      const maximum = random() % 3;
      const expected = fullDistance(left, right);
      expect(boundedLevenshtein(left, right, maximum)).toBe(
        expected <= maximum ? expected : undefined,
      );
    }
  });

  it("boosts title matches above body-only matches with BM25F", () => {
    const source = createLexicalIndexV2(
      [
        { title: "Canvas", heading: "", content: "drawing reference" },
        { title: "Reference", heading: "", content: "canvas drawing" },
      ],
      analyzer,
    );
    const encoded = encodeLexicalV2(source);
    const dictionary = decodeDictionaryV2(encoded.dictionary);
    const expansions = expandQueryTerms(dictionary.terms, "canvas ", analyzer);
    const postings = new Map(
      expansions.map(
        (entry) => [entry.dictionaryIndex, source.terms[entry.dictionaryIndex]!.postings] as const,
      ),
    );
    const scores = scoreLexicalV2(dictionary, expansions, postings).scores;
    expect(scores.get(0)).toBeGreaterThan(scores.get(1)!);
  });

  it("matches a hand-computed BM25F fixture", () => {
    const source = createLexicalIndexV2(
      [{ title: "alpha alpha", heading: "alpha", content: "alpha alpha alpha" }],
      analyzer,
    );
    const encoded = encodeLexicalV2(source);
    const dictionary = decodeDictionaryV2(encoded.dictionary);
    const expansions = expandQueryTerms(dictionary.terms, "alpha ", analyzer);
    const postings = new Map([[0, source.terms[0]!.postings]]);
    const score = scoreLexicalV2(dictionary, expansions, postings).scores.get(0)!;

    const weightedFrequency = 2 * 2 + 1.5 * 1 + 1 * 3;
    const inverseDocumentFrequency = Math.log(1 + 0.5 / 1.5);
    const expected =
      (inverseDocumentFrequency * (weightedFrequency * 2.2)) / (weightedFrequency + 1.2);
    expect(score).toBeCloseTo(expected, 12);
  });
});

describe("highlighting", () => {
  it("maps folded and fuzzy matches back to raw offsets", () => {
    const text = "Try café authentication today";
    const terms = [
      { term: "cafe", source: "cafe", kind: "exact" as const },
      { term: "authentication", source: "authenticaton", kind: "fuzzy" as const, distance: 1 },
    ];
    expect(highlightRanges(text, terms)).toEqual([
      [4, 8],
      [9, 23],
    ]);
    const excerpt = snippet(text, terms, { radius: 10 });
    expect(excerpt.text).toContain("café");
    expect(excerpt.ranges.length).toBeGreaterThan(0);
  });
});

describe("format-v2 runtime", () => {
  it("lazily fetches postings/content and supports prefix, typo, filters, facets, grouping, and pagination", async () => {
    const chunks = [
      { title: "Typo tolerance", heading: "Matching", content: "Find misspelled queries" },
      { title: "Typo tolerance", heading: "Limits", content: "Configure edit distance" },
      { title: "Authentication", heading: "OAuth", content: "Configure providers" },
    ];
    const lexical = encodeLexicalV2(createLexicalIndexV2(chunks, analyzer), 18);
    const content = {
      version: 2 as const,
      chunks: chunks.map((chunk) => ({
        content: chunk.content,
        metadata: { description: chunk.heading },
      })),
    };
    const metadata: CorpusMetadataV2 = {
      version: 2,
      name: "docs",
      documents: ["quality", "auth"],
      chunks: {
        id: ["q1", "q2", "a1"],
        document: [0, 0, 1],
        url: ["/quality#matching", "/quality#limits", "/auth"],
        title: chunks.map((chunk) => chunk.title),
        heading: chunks.map((chunk) => chunk.heading),
        content: [
          [0, 0],
          [0, 1],
          [0, 2],
        ],
        filters: { tags: [["search"], ["search"], ["security"]], stars: [5, 5, 3] },
      },
      facets: { tags: { search: 2, security: 1 } },
    };
    const manifest: SearchManifestV2 = {
      format: "seekite",
      version: 2,
      generatedAt: "2026-01-01T00:00:00.000Z",
      corpora: {
        docs: {
          name: "docs",
          path: "docs",
          chunks: 3,
          format: 2,
          corpus: "corpus.json",
          lexical: { dictionary: "lexical/dictionary.bin", shards: lexical.shards.length },
          content: { prefix: "content/content-", shards: 1 },
          analyzer,
        },
      },
    };
    const assets = new Map<string, string | ArrayBuffer>([
      ["/search/manifest.json", JSON.stringify(manifest)],
      ["/search/docs/corpus.json", JSON.stringify(metadata)],
      ["/search/docs/lexical/dictionary.bin", arrayBuffer(lexical.dictionary)],
      ["/search/docs/content/content-000.json", JSON.stringify(content)],
      ...lexical.shards.map((shard, index): [string, ArrayBuffer] => [
        `/search/docs/lexical/postings-${String(index).padStart(3, "0")}.bin`,
        arrayBuffer(shard),
      ]),
    ]);
    const requested: string[] = [];
    const client = createSearch({
      fetch: async (input) => {
        const key = String(input);
        requested.push(key);
        const body = assets.get(key);
        return body === undefined ? new Response(null, { status: 404 }) : new Response(body);
      },
    });

    await client.load("docs");
    expect(requested.some((url) => url.includes("postings"))).toBe(false);
    expect(requested.some((url) => url.includes("content-"))).toBe(false);

    const prefix = await client.query("auth", { mode: "lexical", facets: ["tags"] });
    expect(prefix.results[0]).toMatchObject({
      document: { id: "auth" },
      content: "Configure providers",
    });
    expect(prefix.facets).toEqual({ tags: { security: 1 } });
    expect(requested.some((url) => url.includes("postings"))).toBe(true);
    expect(requested.some((url) => url.includes("content-"))).toBe(true);

    const typo = await client.query("tolarance ", {
      mode: "lexical",
      where: { tags: { in: ["search"] }, stars: { gte: 4 } },
      group: "expanded",
      hydrate: false,
    });
    expect(typo.total).toBe(1);
    expect(typo.results[0]).toMatchObject({ document: { id: "quality", matches: 2 } });
    expect(typo.results[0]?.document.chunks).toHaveLength(2);
    expect(typo.results[0]?.terms[0]?.kind).toBe("fuzzy");

    const where = { tags: { in: ["search"] }, stars: { gte: 4 } } as const;
    const faceted = await client.query("tolerance ", {
      mode: "lexical",
      where,
      facets: ["tags", "stars"],
      group: "none",
      hydrate: false,
    });
    const matchingRows = metadata.chunks.id
      .map((_id, index) => index)
      .filter(
        (index) =>
          (metadata.chunks.filters.tags[index] as string[]).includes("search") &&
          (metadata.chunks.filters.stars[index] as number) >= 4 &&
          chunks[index]!.title.toLocaleLowerCase().includes("tolerance"),
      );
    const bruteFacets = Object.fromEntries(
      ["tags", "stars"].map((field) => {
        const counts: Record<string, number> = {};
        for (const index of matchingRows) {
          const raw = metadata.chunks.filters[field]![index];
          for (const value of new Set(Array.isArray(raw) ? raw : [raw]))
            counts[String(value)] = (counts[String(value)] ?? 0) + 1;
        }
        return [field, counts];
      }),
    );
    expect(faceted.facets).toEqual(bruteFacets);

    const groupedAgain = await client.query("tolerance ", {
      mode: "lexical",
      group: "expanded",
      hydrate: false,
    });
    const groupedOnceMore = await client.query("tolerance ", {
      mode: "lexical",
      group: "expanded",
      hydrate: false,
    });
    expect(groupedAgain).toEqual(groupedOnceMore);
    expect(groupedAgain.results[0]).toMatchObject({
      id: "q1",
      document: { id: "quality", matches: 2 },
    });
    expect(groupedAgain.results[0]?.document.chunks?.map((chunk) => chunk.id)).toEqual([
      "q1",
      "q2",
    ]);

    const page = await client.query("tolerance ", {
      mode: "lexical",
      group: "none",
      offset: 1,
      limit: 1,
    });
    expect(page.total).toBe(2);
    expect(page.results).toHaveLength(1);

    const corrupt = createSearch({
      fetch: async (input) => {
        const key = String(input);
        const body = assets.get(key);
        if (body === undefined) return new Response(null, { status: 404 });
        if (key.includes("postings-") && body instanceof ArrayBuffer) {
          return new Response(body.slice(0, Math.max(0, body.byteLength - 1)));
        }
        return new Response(body);
      },
    });
    await expect(corrupt.query("tolerance ", { mode: "lexical" })).rejects.toBeInstanceOf(
      SeekiteFormatError,
    );
  });
});
