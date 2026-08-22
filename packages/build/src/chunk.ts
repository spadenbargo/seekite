import { createHash } from "node:crypto";
import type { SearchChunk, SearchDocument } from "@seekite/core";
import { load } from "cheerio";

interface Section {
  heading?: string;
  text: string;
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function htmlSections(document: SearchDocument): { title: string; sections: Section[] } {
  const $ = load(document.content);
  $("script, style, template, noscript, nav").remove();
  const title =
    document.title ||
    clean($("title").first().text()) ||
    clean($("h1").first().text()) ||
    document.url;
  const sections: Section[] = [];
  let heading: string | undefined;
  let fragments: string[] = [];

  const flush = () => {
    const text = clean(fragments.join(" "));
    if (text) sections.push({ heading, text });
    fragments = [];
  };

  $("main, article")
    .first()
    .find("h1, h2, h3, h4, h5, h6, p, li, pre, blockquote")
    .each((_index, element) => {
      const tag = element.tagName.toLowerCase();
      const text = clean($(element).text());
      if (!text) return;
      if (/^h[1-6]$/.test(tag)) {
        flush();
        heading = text;
      } else {
        fragments.push(text);
      }
    });

  flush();
  if (sections.length === 0) sections.push({ text: clean($("body").text() || $.root().text()) });
  return { title, sections };
}

function textSections(document: SearchDocument): { title: string; sections: Section[] } {
  const sections: Section[] = [];
  let heading: string | undefined;
  let fragments: string[] = [];
  const flush = () => {
    const text = clean(fragments.join(" "));
    if (text) sections.push({ heading, text });
    fragments = [];
  };
  for (const line of document.content.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (match) {
      flush();
      heading = clean(match[2] ?? "");
    } else {
      fragments.push(line);
    }
  }
  flush();
  return { title: document.title || sections[0]?.heading || document.url, sections };
}

function stableId(...values: string[]): string {
  return createHash("sha256").update(values.join("\0")).digest("hex").slice(0, 16);
}

export function chunkDocument(
  document: SearchDocument,
  options: { maxWords?: number; overlapWords?: number } = {},
): SearchChunk[] {
  const maxWords = Math.max(20, options.maxWords ?? 180);
  const overlapWords = Math.min(maxWords - 1, Math.max(0, options.overlapWords ?? 30));
  const parsed =
    document.metadata?.seekiteFormat === "html" ? htmlSections(document) : textSections(document);
  const chunks: SearchChunk[] = [];

  for (const section of parsed.sections) {
    const words = section.text.split(/\s+/).filter(Boolean);
    const step = maxWords - overlapWords;
    for (let offset = 0; offset < words.length; offset += step) {
      const content = words.slice(offset, offset + maxWords).join(" ");
      if (!content) continue;
      const id = stableId(document.id, section.heading ?? "", String(offset));
      const { seekiteFormat: _format, ...metadata } = document.metadata ?? {};
      chunks.push({
        id,
        documentId: document.id,
        url: document.url,
        title: parsed.title,
        heading: section.heading,
        content,
        metadata,
      });
      if (offset + maxWords >= words.length) break;
    }
  }

  return chunks;
}
