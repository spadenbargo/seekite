import { parseMarkdown } from "@tanstack/markdown/parser";
import type { MarkdownDocument } from "@tanstack/markdown";
import { docsMarkdownExtensions } from "@tanstack/markdown/extensions/docs";

export interface DocFrontmatter {
  title: string;
  section: string;
  order: number;
}

export interface DocPage extends DocFrontmatter {
  slug: string;
  sourcePath: string;
  description: string;
  document: MarkdownDocument;
}

export const markdownExtensions = docsMarkdownExtensions({ collectHeadings: true });

const markdownSources = import.meta.glob<string>("../../../docs/**/*.md", {
  eager: true,
  import: "default",
  query: "?raw",
});

function unquote(value: string): string {
  const trimmed = value.trim();
  const first = trimmed[0];
  if ((first === '"' || first === "'") && trimmed.at(-1) === first) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function splitFrontmatter(source: string): {
  attributes: Record<string, string>;
  body: string;
} {
  if (!source.startsWith("---\n") && !source.startsWith("---\r\n")) {
    return { attributes: {}, body: source };
  }

  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { attributes: {}, body: source };

  const attributes: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const entry = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (entry?.[1]) attributes[entry[1]] = unquote(entry[2] ?? "");
  }
  return { attributes, body: source.slice(match[0].length) };
}

function slugFromPath(sourcePath: string): string {
  const normalized = sourcePath.replaceAll("\\", "/");
  const match = /\/docs\/(.+)\.md$/.exec(normalized);
  if (!match?.[1]) throw new Error(`Unable to derive a documentation slug from ${sourcePath}`);
  return match[1].replace(/\/index$/, "");
}

function fallbackTitle(document: MarkdownDocument, slug: string): string {
  return (
    document.headings?.find((heading) => heading.level === 1)?.text ??
    slug
      .split("/")
      .at(-1)!
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function fallbackSection(slug: string): string {
  return slug.includes("/") ? "Integrations" : "Guides";
}

function descriptionFromBody(body: string): string {
  const paragraph = body
    .replace(/^#[^\n]*\n+/, "")
    .split(/\n\s*\n/)
    .find((value) => value.trim() && !value.trimStart().startsWith("```"));
  return (paragraph ?? "Seekite documentation")
    .replace(/[`*_#[\]]/g, "")
    .replace(/\(([^)]+)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function toPage(sourcePath: string, source: string): DocPage {
  const slug = slugFromPath(sourcePath);
  const { attributes, body } = splitFrontmatter(source);
  const document = parseMarkdown(body, {
    allowHtml: false,
    headingIds: true,
    extensions: markdownExtensions,
  });
  const parsedOrder = Number(attributes["order"]);
  return {
    slug,
    sourcePath: `docs/${slug}.md`,
    title: attributes["title"] || fallbackTitle(document, slug),
    section: attributes["section"] || fallbackSection(slug),
    order: Number.isFinite(parsedOrder) ? parsedOrder : 999,
    description: descriptionFromBody(body),
    document,
  };
}

export const docs = Object.entries(markdownSources)
  .map(([sourcePath, source]) => toPage(sourcePath, source))
  .sort(
    (left, right) =>
      left.section.localeCompare(right.section) ||
      left.order - right.order ||
      left.title.localeCompare(right.title),
  );

const docsBySlug = new Map(docs.map((page) => [page.slug, page]));

export function getDoc(slug: string | undefined): DocPage | undefined {
  return slug ? docsBySlug.get(slug.replace(/^\/+|\/+$/g, "")) : undefined;
}

function normalizeSegments(value: string): string {
  const segments: string[] = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
}

export function resolveMarkdownHref(currentSlug: string, href: string): string {
  if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return href;
  const [rawPath = "", fragment] = href.split("#", 2);
  if (rawPath.startsWith("/")) return href;

  const currentDirectory = currentSlug.includes("/")
    ? currentSlug.slice(0, currentSlug.lastIndexOf("/"))
    : "";
  const markdownPath = rawPath
    ? normalizeSegments(`${currentDirectory}/${rawPath.replace(/\.md$/i, "")}`)
    : currentSlug;
  const route = `/docs/${markdownPath}`;
  return fragment ? `${route}#${fragment}` : route;
}

export const docsBySection = docs.reduce<Record<string, DocPage[]>>((sections, page) => {
  (sections[page.section] ??= []).push(page);
  return sections;
}, {});
