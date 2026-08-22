import { bench, describe } from "vite-plus/test";
import { createLexicalIndexV2 } from "./lexical.js";
import { decodeDictionaryV2, encodeLexicalV2 } from "./codec.js";

const analyzer = { folding: true, stemmer: null } as const;
const source = encodeLexicalV2(
  createLexicalIndexV2(
    Array.from({ length: 25_000 }, (_unused, index) => ({
      title: `Document ${index}`,
      heading: `Section ${index % 50}`,
      content: `alpha beta gamma delta term${index % 5_000}`,
    })),
    analyzer,
  ),
).dictionary;

describe("format-v2 codecs", () => {
  bench("decode front-coded dictionary", () => {
    decodeDictionaryV2(source);
  });
});
