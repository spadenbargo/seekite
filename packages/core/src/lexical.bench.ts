import { bench, describe } from "vite-plus/test";
import { expandQueryTerms } from "./analyzer.js";
import { decodeDictionaryV2, decodePostingsV2, encodeLexicalV2 } from "./codec.js";
import { createLexicalIndexV2, scoreLexicalV2 } from "./lexical.js";

const analyzer = { folding: true, stemmer: null } as const;
const chunks = Array.from({ length: 10_000 }, (_unused, index) => ({
  title: `Guide ${index}`,
  heading: index % 2 === 0 ? "Configuration" : "Reference",
  content: `local static search canvas authentication provider term${index % 1_000}`,
}));
const encoded = encodeLexicalV2(createLexicalIndexV2(chunks, analyzer));
const dictionary = decodeDictionaryV2(encoded.dictionary);

describe("format-v2 lexical query", () => {
  bench("prefix expansion + BM25F", () => {
    const expansions = expandQueryTerms(dictionary.terms, "local auth", analyzer);
    const postings = new Map(
      expansions.map((entry) => {
        const term = dictionary.terms[entry.dictionaryIndex]!;
        return [
          entry.dictionaryIndex,
          decodePostingsV2(encoded.shards[term.shard]!, term.offset, term.documentFrequency),
        ] as const;
      }),
    );
    scoreLexicalV2(dictionary, expansions, postings);
  });
});
