import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { SearchDocument } from "@seekite/core";
import { load } from "cheerio";
import matter from "gray-matter";
import { marked } from "marked";
import { glob } from "tinyglobby";
import type { SourceAdapter, SourceContext } from "./types.js";

const DEFAULT_BODY_SELECTORS = ["[data-seekite-body]", "main", "article", "body"];
const DEFAULT_EXCLUSION_SELECTORS = [
  "script",
  "style",
  "template",
  "noscript",
  "nav",
  "aside",
  "svg",
  "math",
  "[data-seekite-ignore]",
];

export interface GeneratedHTMLOptions {
  /** Directory to scan. Relative paths are resolved from the build root. */
  directory?: string;
  /** Ordered selectors; the first selector with a match becomes the page body. */
  bodySelector?: string | string[];
  /** Additional selectors removed from the chosen body before it is chunked. */
  excludeSelectors?: string[];
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHTML(bytes: Uint8Array): string {
  const probe = Buffer.from(
    bytes.buffer,
    bytes.byteOffset,
    Math.min(bytes.byteLength, 4096),
  ).toString("latin1");
  const declared =
    /<meta\s+[^>]*charset\s*=\s*["']?\s*([^\s"'/>;]+)/i.exec(probe)?.[1] ??
    /<meta\s+[^>]*content\s*=\s*["'][^"']*charset\s*=\s*([^\s"';>]+)/i.exec(probe)?.[1];
  try {
    return new TextDecoder(declared || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

function routeFromHTML(relativePath: string): string {
  const normalized = relativePath.split(path.sep).join("/");
  if (normalized === "index.html") return "/";
  return `/${normalized.replace(/\/index\.html$/, "").replace(/\.html$/, "")}`;
}

function bodySelectors(value: GeneratedHTMLOptions["bodySelector"]): string[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : DEFAULT_BODY_SELECTORS;
}

function normalizedMetadataKey(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (lower.startsWith("data-seekite-")) return lower.slice("data-seekite-".length);
  if (lower.startsWith("og:")) return lower.slice("og:".length);
  if (lower === "docusaurus_locale") return "locale";
  if (lower === "docusaurus_version") return "version";
  return undefined;
}

function generatedHTMLOptions(
  directoryOrOptions: string | GeneratedHTMLOptions | undefined,
  overrides: Omit<GeneratedHTMLOptions, "directory">,
): GeneratedHTMLOptions {
  return typeof directoryOrOptions === "string"
    ? { ...overrides, directory: directoryOrOptions }
    : { ...directoryOrOptions, ...overrides };
}

/**
 * Load rendered HTML without indexing navigation, sidebars, scripts, SVG, or
 * MathML noise. The selected body is wrapped in `main` so `chunkDocument`
 * applies exactly the same heading boundaries to every integration.
 */
export function generatedHTML(
  directoryOrOptions?: string | GeneratedHTMLOptions,
  overrides: Omit<GeneratedHTMLOptions, "directory"> = {},
): SourceAdapter {
  const options = generatedHTMLOptions(directoryOrOptions, overrides);
  const selectors = bodySelectors(options.bodySelector);
  const exclusions = [
    ...new Set([...DEFAULT_EXCLUSION_SELECTORS, ...(options.excludeSelectors ?? [])]),
  ];

  return {
    name: "generated-html",
    async load(context: SourceContext) {
      const root = path.resolve(context.root, options.directory ?? context.generatedDir);
      const files = await glob("**/*.html", {
        cwd: root,
        absolute: true,
        ignore: ["node_modules/**", "dist/**", "public/search/**"],
      });

      return Promise.all(
        files.map(async (file): Promise<SearchDocument> => {
          const relative = path.relative(root, file).split(path.sep).join("/");
          const route = routeFromHTML(relative);
          const html = decodeHTML(await readFile(file));
          const $ = load(html);
          const metadata: Record<string, string> = {};

          $("meta").each((_index, element) => {
            const meta = $(element);
            const name = meta.attr("name") ?? meta.attr("property");
            const content = meta.attr("content");
            if (name && content !== undefined) {
              const value = clean(content);
              if (value) {
                metadata[name] ??= value;
                const normalized = normalizedMetadataKey(name);
                if (normalized) metadata[normalized] ??= value;
              }
            }

            for (const [attribute, rawValue] of Object.entries(element.attribs ?? {})) {
              const normalized = normalizedMetadataKey(attribute);
              if (!normalized || normalized === "body" || normalized === "ignore") continue;
              const value = clean(rawValue);
              if (value) metadata[normalized] ??= value;
            }
          });

          let body = selectors
            .map((selector) => $(selector).first())
            .find((candidate) => candidate.length > 0);
          body ??= $("body").first();
          if (body.length === 0) body = $.root();
          if (exclusions.length > 0) body.find(exclusions.join(",")).remove();

          const heading = clean(body.find("h1").first().text() || $("h1").first().text());
          const title = clean(
            $("meta[name='data-seekite-title']").attr("content") ??
              $("meta[data-seekite-title]").attr("data-seekite-title") ??
              $("meta[property='og:title']").attr("content") ??
              $("title").first().text() ??
              heading ??
              route,
          );
          const language = clean($("html").attr("lang") ?? "");
          if (language) {
            metadata.lang ??= language;
            metadata.locale ??= language;
          }

          return {
            id: route,
            url: route,
            title: title || heading || route,
            content: `<main data-seekite-extracted>${body.html() ?? ""}</main>`,
            metadata: {
              ...metadata,
              seekiteFormat: "html",
              sourcePath: relative,
            },
          };
        }),
      );
    },
  };
}

export function filesystem(pattern: string | string[]): SourceAdapter {
  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  return {
    name: "filesystem",
    async load(context: SourceContext) {
      const absolutePatterns = await Promise.all(
        patterns.map(async (entry) => {
          const absolute = path.isAbsolute(entry) ? entry : path.resolve(context.root, entry);
          const information = await stat(absolute).catch(() => undefined);
          return information?.isDirectory() ? path.join(absolute, "**/*.{md,mdx,html}") : absolute;
        }),
      );
      const files = await glob(absolutePatterns, { absolute: true, onlyFiles: true });
      return Promise.all(
        files.map(async (file): Promise<SearchDocument> => {
          const raw = await readFile(file, "utf8");
          const parsed = matter(raw);
          const relative = path.relative(context.root, file).split(path.sep).join("/");
          const extension = path.extname(file);
          const withoutExtension = relative.slice(0, -extension.length).replace(/\/index$/, "");
          const url = `/${withoutExtension}`;
          return {
            id: relative,
            url,
            title: typeof parsed.data.title === "string" ? parsed.data.title : "",
            content: await marked.parse(parsed.content),
            metadata: { ...parsed.data, seekiteFormat: "html", sourcePath: relative },
          };
        }),
      );
    },
  };
}
