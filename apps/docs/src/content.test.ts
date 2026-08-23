import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { docs, getDoc, resolveMarkdownHref, splitFrontmatter } from "./content";

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(absolute) : [absolute];
  });
}

describe("documentation content", () => {
  it("discovers every root Markdown page with navigation metadata", () => {
    expect(docs.length).toBeGreaterThan(10);
    expect(docs.every((page) => page.title && page.section && Number.isFinite(page.order))).toBe(
      true,
    );
    expect(getDoc("search-quality")?.title).toBe("Search quality");
    expect(getDoc("integrations/vite")?.section).toBe("Integrations");
  });

  it("tolerates absent frontmatter and parses quoted values", () => {
    expect(splitFrontmatter("# Plain")).toEqual({ attributes: {}, body: "# Plain" });
    expect(splitFrontmatter('---\ntitle: "Hello"\norder: 4\n---\n# Body')).toEqual({
      attributes: { title: "Hello", order: "4" },
      body: "# Body",
    });
  });

  it("turns repository-relative Markdown links into nested documentation routes", () => {
    expect(resolveMarkdownHref("getting-started", "configuration.md#corpora")).toBe(
      "/docs/configuration#corpora",
    );
    expect(resolveMarkdownHref("integrations/vite", "../incremental-builds.md")).toBe(
      "/docs/incremental-builds",
    );
    expect(resolveMarkdownHref("integrations/vite", "#build-mode")).toBe(
      "/docs/integrations/vite#build-mode",
    );
    expect(resolveMarkdownHref("providers", "https://example.com/docs")).toBe(
      "https://example.com/docs",
    );
  });

  it("keeps the integration marks in local source assets", () => {
    const sourceDirectory = import.meta.dirname;
    const brandDirectory = path.join(sourceDirectory, "assets/brand");
    const expectedAssets = [
      "astro-dark.svg",
      "astro-light.svg",
      "docusaurus.svg",
      "github-dark.svg",
      "github-light.svg",
      "nextjs.svg",
      "vite.svg",
    ];

    expect(new Set(readdirSync(brandDirectory))).toEqual(new Set(expectedAssets));
    for (const asset of expectedAssets) {
      expect(readFileSync(path.join(brandDirectory, asset), "utf8")).toMatch(/^<svg(?:\s|>)/);
    }

    const forbiddenProviderName = ["sv", "gl"].join("");
    for (const sourceFile of filesBelow(sourceDirectory)) {
      expect(readFileSync(sourceFile, "utf8").toLowerCase()).not.toContain(forbiddenProviderName);
    }
  });
});
