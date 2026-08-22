import { describe, expect, it } from "vite-plus/test";
import {
  SeekiteFormatError,
  createLexicalIndexV2,
  decodeDictionaryV2,
  decodePostingsV2,
  decodeVectorsV2,
  encodeLexicalV2,
  encodeVectorsV2,
  vectorSimilarity,
} from "./index.js";

const analyzer = { folding: true, stemmer: null } as const;

describe("format-v2 lexical codec", () => {
  it("locks the byte layout for a tiny fixture", () => {
    const source = createLexicalIndexV2(
      [{ title: "Alpha", heading: "Beta", content: "alpha" }],
      analyzer,
    );
    const encoded = encodeLexicalV2(source, 1024);

    expect(Buffer.from(encoded.dictionary).toString("hex")).toBe(
      "534b44580200000003010000803f0000803f0000803f010101020005616c706861010000000462657461010005010a",
    );
    expect(encoded.shards.map((shard) => Buffer.from(shard).toString("hex"))).toEqual([
      "01000100010100000100",
    ]);
  });

  it("round-trips the dictionary and sharded field postings", () => {
    const source = createLexicalIndexV2(
      [
        { title: "Canvas", heading: "Draw", content: "Draw a rectangle" },
        { title: "Authentication", heading: "OAuth", content: "Configure a callback" },
      ],
      analyzer,
    );
    const encoded = encodeLexicalV2(source, 12);
    const dictionary = decodeDictionaryV2(encoded.dictionary);
    expect(new TextDecoder().decode(encoded.dictionary.subarray(0, 4))).toBe("SKDX");
    expect(dictionary).toMatchObject({ version: 2, documentCount: 2 });
    expect(dictionary.terms.map((term) => term.term)).toEqual(
      dictionary.terms.map((term) => term.term).toSorted(),
    );
    expect(encoded.shards.length).toBeGreaterThan(1);
    dictionary.terms.forEach((term) => {
      expect(
        decodePostingsV2(encoded.shards[term.shard]!, term.offset, term.documentFrequency, 2)
          .length,
      ).toBe(term.documentFrequency);
    });
  });

  it("rejects malformed binary inputs with typed errors", () => {
    const source = createLexicalIndexV2(
      [{ title: "One", heading: "", content: "alpha beta" }],
      analyzer,
    );
    const encoded = encodeLexicalV2(source);
    expect(() => decodeDictionaryV2(encoded.dictionary.subarray(0, 7))).toThrow(SeekiteFormatError);
    const badMagic = encoded.dictionary.slice();
    badMagic[0] = 0;
    expect(() => decodeDictionaryV2(badMagic)).toThrow(SeekiteFormatError);
    expect(() => decodeDictionaryV2(badMagic)).toThrow(/magic/i);
    const dictionary = decodeDictionaryV2(encoded.dictionary);
    const term = dictionary.terms[0]!;
    expect(() =>
      decodePostingsV2(
        encoded.shards[term.shard]!.subarray(0, 1),
        term.offset,
        term.documentFrequency,
      ),
    ).toThrow(SeekiteFormatError);
    expect(() => decodePostingsV2(Uint8Array.of(2, 0, 1, 0, 0, 0, 1, 0, 0), 0, 2, 2)).toThrow(
      /strictly increasing/i,
    );
    expect(() => decodePostingsV2(Uint8Array.of(1, 0, 0, 0, 0), 0, 1, 1)).toThrow(
      /term frequency/i,
    );
  });

  it("survives deterministic randomized round trips", () => {
    let state = 42;
    const random = () => (state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0) / 2 ** 32;
    for (let run = 0; run < 40; run += 1) {
      const chunks = Array.from({ length: 1 + Math.floor(random() * 15) }, (_unused, index) => ({
        title: `title${Math.floor(random() * 5)}`,
        heading: `heading${index % 3}`,
        content: Array.from(
          { length: 2 + Math.floor(random() * 12) },
          () => `term${Math.floor(random() * 12)}`,
        ).join(" "),
      }));
      const source = createLexicalIndexV2(chunks, analyzer);
      const encoded = encodeLexicalV2(source, 30);
      const dictionary = decodeDictionaryV2(encoded.dictionary);
      expect(dictionary.documentCount).toBe(source.documentCount);
      dictionary.terms.forEach((term, index) => {
        expect(
          decodePostingsV2(
            encoded.shards[term.shard]!,
            term.offset,
            term.documentFrequency,
            chunks.length,
          ),
        ).toEqual(source.terms[index]!.postings);
      });
    }
  });
});

describe("format-v2 vector codec", () => {
  const vectors = [new Float32Array([0.6, 0.8]), new Float32Array([-1, 0])];

  it("round-trips headered f32 vectors", () => {
    const encoded = encodeVectorsV2(vectors, 2, "f32");
    expect(new TextDecoder().decode(encoded.subarray(0, 4))).toBe("SKVX");
    const decoded = decodeVectorsV2(encoded, 2);
    expect(decoded.dtype).toBe("f32");
    expect([...decoded.values]).toEqual([0.6, 0.8, -1, 0].map(Math.fround));
    expect(vectorSimilarity(decoded, 0, new Float32Array([0.6, 0.8]))).toBeCloseTo(1);
  });

  it("quantizes to i8 at about one quarter of the f32 payload", () => {
    const i8 = encodeVectorsV2(vectors, 2, "i8");
    const decoded = decodeVectorsV2(i8, 2);
    expect(decoded.dtype).toBe("i8");
    const representative = Array.from({ length: 8 }, (_value, row) =>
      Float32Array.from({ length: 384 }, (_entry, column) => Math.sin(row * 384 + column)),
    );
    expect(
      encodeVectorsV2(representative, 384, "f32").byteLength /
        encodeVectorsV2(representative, 384, "i8").byteLength,
    ).toBeGreaterThan(3);
    expect(vectorSimilarity(decoded, 0, vectors[0]!)).toBeGreaterThan(0.999);
    expect(() => decodeVectorsV2(i8, 3)).toThrow(/dimensions mismatch/i);
    expect(() => decodeVectorsV2(i8.subarray(0, -1))).toThrow(SeekiteFormatError);
  });

  it("rejects malformed headers and truncated payloads with typed errors", () => {
    const encoded = encodeVectorsV2(vectors, 2, "f32");
    const badMagic = encoded.slice();
    badMagic[0] = 0;
    const badVersion = encoded.slice();
    badVersion[4] = 3;
    const badDtype = encoded.slice();
    badDtype[6] = 2;

    for (const malformed of [
      encoded.subarray(0, 7),
      badMagic,
      badVersion,
      badDtype,
      encoded.subarray(0, -1),
    ]) {
      expect(() => decodeVectorsV2(malformed, 2)).toThrow(SeekiteFormatError);
    }
  });

  it("round-trips deterministic randomized f32 rows", () => {
    let state = 0x51eec0de;
    const random = () => (state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0) / 2 ** 32;
    for (let run = 0; run < 30; run += 1) {
      const dimensions = 1 + Math.floor(random() * 24);
      const randomVectors = Array.from({ length: Math.floor(random() * 12) }, () =>
        Float32Array.from({ length: dimensions }, () => random() * 2 - 1),
      );
      const decoded = decodeVectorsV2(
        encodeVectorsV2(randomVectors, dimensions, "f32"),
        dimensions,
      );
      expect(decoded.count).toBe(randomVectors.length);
      expect([...decoded.values]).toEqual(
        randomVectors.flatMap((vector) => [...vector].map(Math.fround)),
      );
    }
  });
});
