/**
 * Parity fixture corpus.
 *
 * The native addon and the wasm build must return bit-identical vectors for
 * every one of these — that equality is what lets both backends share the
 * provider id `seekite:ternlight:mini:v1`, so an index built in CI (native) is
 * queryable in a browser (wasm).
 *
 * The set is chosen to exercise the places where two builds of the same Rust
 * could plausibly diverge:
 *
 * - **Scripts and normalisation** — Latin, Cyrillic, Greek, CJK, Hangul,
 *   Arabic/Hebrew (RTL), Devanagari, Thai, plus combining marks and a
 *   pre-composed/decomposed pair. Tokenizer drift shows up here first.
 * - **Astral-plane input** — emoji, ZWJ sequences, skin-tone modifiers, flags.
 *   These are surrogate pairs in JS and 4-byte UTF-8 in Rust.
 * - **Degenerate inputs** — empty, whitespace, a lone punctuation mark. These
 *   drive `n_active` to its floor (only `[CLS]`/`[SEP]` survive) and hit the
 *   `max(1e-9)` guards in mean-pool and L2-normalise.
 * - **Truncation** — inputs well past `max_seq_len` (128), so the two builds
 *   must agree on *where* to cut, not just on the arithmetic.
 * - **Structured text** — code, URLs, numbers, punctuation runs; the token
 *   distribution here is very different from prose.
 */
export const PARITY_FIXTURES: readonly string[] = [
  // ── degenerate / empty-ish ────────────────────────────────────────────────
  "",
  " ",
  "\n",
  "\t \n  ",
  "a",
  ".",
  "?!",
  "…",
  "​", // zero-width space
  " ", // non-breaking space

  // ── short English ─────────────────────────────────────────────────────────
  "hello world",
  "Hello, World!",
  "HELLO WORLD",
  "The quick brown fox jumps over the lazy dog.",
  "search",
  "static site search that works offline",

  // ── multilingual ──────────────────────────────────────────────────────────
  "Bonjour tout le monde, comment allez-vous aujourd'hui ?",
  "Grüße aus München — Straßenbahn, Fußgängerzone, Übermensch.",
  "El veloz murciélago hindú comía feliz cardillo y kiwi.",
  "Ciao, questo è un documento di prova per la ricerca semantica.",
  "Olá, este é um teste de pesquisa semântica em português.",
  "Съешь же ещё этих мягких французских булок, да выпей чаю.",
  "Γνωρίζω ἀπὸ τὴν κόψη τοῦ σπαθιοῦ τὴν τρομερή.",
  "这是一个用于测试语义搜索的中文句子。",
  "日本語のテキストも正しく埋め込まれる必要があります。",
  "한국어 문장도 동일한 벡터를 생성해야 합니다.",
  "مرحبا بالعالم، هذا نص تجريبي للبحث الدلالي.",
  "שלום עולם, זהו טקסט לבדיקת חיפוש סמנטי.",
  "नमस्ते दुनिया, यह अर्थपूर्ण खोज का परीक्षण है।",
  "สวัสดีชาวโลก นี่คือข้อความทดสอบ",
  "Tiếng Việt có dấu thanh điệu và nguyên âm ghép.",
  "Türkçe karakterler: ıİşŞğĞçÇöÖüÜ.",
  "Zażółć gęślą jaźń — polski pangram.",

  // ── unicode edge cases ────────────────────────────────────────────────────
  "café", // pre-composed é
  "café", // decomposed e + combining acute — same glyph, different bytes
  "ﬁreﬂy ligatures and ½ fractions",
  "Ⅷ Ⅻ ⅘ roman and vulgar numerals",
  "ź́́́ stacked combining marks",

  // ── emoji / astral plane ──────────────────────────────────────────────────
  "🔍",
  "search 🔍 fast ⚡ offline 📦",
  "👩‍💻👨‍👩‍👧‍👦🏳️‍🌈", // ZWJ sequences
  "👍🏽👍🏿 skin tone modifiers",
  "🇦🇺🇯🇵🇺🇸 regional indicator flags",
  "🙂🙃😀😃😄😁😆😅🤣😂 a run of emoji with no words at all",

  // ── structured text ───────────────────────────────────────────────────────
  "https://seekite-docs.baden-spargo.workers.dev/docs/getting-started#install",
  "const engine = createNativeEngine({ model: 'mini' })",
  "SELECT id, title FROM documents WHERE rank > 0.5 ORDER BY rank DESC;",
  "3.14159265358979 2.71828182845905 1.61803398874989",
  "v1.2.3-rc.4+build.567",
  "a,b,c;d|e\tf",

  // ── long inputs (past max_seq_len = 128 tokens) ───────────────────────────
  "Seekite builds a semantic search index at build time and ships it as static assets, so search works on any static host with no server, no database, and no third-party API. The index is a compact binary file that the browser fetches once and queries locally, which keeps queries fast and private.",
  "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(20),
  "重复的中文文本用于测试截断行为。".repeat(30),
  "🔍".repeat(200),
  Array.from({ length: 300 }, (_, i) => `token${i}`).join(" "),
];
