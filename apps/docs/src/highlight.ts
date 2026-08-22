import {
  createHighlighter,
  defineLanguage,
  type HighlightTokenClass,
  type TokenRange,
} from "@tanstack/highlight/core";
import { createTanStackMarkdownHighlighter } from "@tanstack/highlight/markdown";
import { css } from "@tanstack/highlight/languages/css";
import { html } from "@tanstack/highlight/languages/html";
import { js } from "@tanstack/highlight/languages/js";
import { json } from "@tanstack/highlight/languages/json";
import { plaintext } from "@tanstack/highlight/languages/plaintext";
import { shell } from "@tanstack/highlight/languages/shell";
import { toml } from "@tanstack/highlight/languages/toml";
import { ts } from "@tanstack/highlight/languages/ts";
import { tsx } from "@tanstack/highlight/languages/tsx";
import { yaml } from "@tanstack/highlight/languages/yaml";

const rustKeywords = new Set([
  "as",
  "async",
  "await",
  "break",
  "const",
  "continue",
  "crate",
  "dyn",
  "else",
  "enum",
  "extern",
  "false",
  "fn",
  "for",
  "if",
  "impl",
  "in",
  "let",
  "loop",
  "match",
  "mod",
  "move",
  "mut",
  "pub",
  "ref",
  "return",
  "self",
  "Self",
  "static",
  "struct",
  "super",
  "trait",
  "true",
  "type",
  "unsafe",
  "use",
  "where",
  "while",
]);

const rustToken =
  /\/\*[\s\S]*?\*\/|\/\/[^\n]*|r#*"[\s\S]*?"#*|b?"(?:\\.|[^"\\])*"|b?'(?:\\.|[^'\\])'|\b\d(?:[\d_]*(?:\.\d+)?)?\b|\b[A-Za-z_][A-Za-z\d_]*!?\b/g;

const rust = defineLanguage({
  name: "rust",
  aliases: ["rs"],
  tokenize(code) {
    const ranges: TokenRange[] = [];
    for (const match of code.matchAll(rustToken)) {
      const value = match[0];
      const start = match.index;
      let className: HighlightTokenClass | undefined;
      if (value.startsWith("//") || value.startsWith("/*")) className = "comment";
      else if (/^(?:r#*|b)?["']/.test(value)) className = "string";
      else if (/^\d/.test(value)) className = "number";
      else if (rustKeywords.has(value)) className = "keyword";
      else if (value.endsWith("!")) className = "function";
      else if (/^[A-Z]/.test(value)) className = "type";
      if (className) ranges.push({ start, end: start + value.length, className });
    }
    return ranges;
  },
});

export const highlighter = createHighlighter({
  fallbackLanguage: "plaintext",
  languages: [plaintext, ts, tsx, rust, shell, json, toml, yaml, html, css, js],
});

// TanStack Markdown owns the surrounding <pre><code>. Its contract expects
// escaped inner token markup, which this adapter returns without extra wrappers.
export const markdownHighlighter = createTanStackMarkdownHighlighter(highlighter);
