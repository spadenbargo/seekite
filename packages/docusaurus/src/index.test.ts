import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import type { SearchUIClient } from "@seekite/react";
import seekiteDocusaurus from "./index.js";
import { SeekiteSearchBar } from "./theme.js";

describe("Docusaurus integration", () => {
  it("indexes postBuild output with version and locale facets", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "seekite-docusaurus-"));
    const outDir = path.join(root, "build", "docs");
    await mkdir(outDir, { recursive: true });
    await writeFile(
      path.join(outDir, "index.html"),
      `<html lang="en"><head>
        <meta name="docusaurus_version" content="3.0">
        <meta name="docusaurus_locale" content="en">
      </head><body><article class="theme-doc-markdown"><h1>Docs</h1><p>Versioned docs.</p></article></body></html>`,
    );
    const plugin = seekiteDocusaurus({ siteDir: root, baseUrl: "/handbook/" });

    expect(await readFile(path.join(plugin.getThemePath(), "SearchBar.js"), "utf8")).toContain(
      "SeekiteSearchBar",
    );
    expect(plugin.injectHtmlTags()).toEqual({
      headTags: [
        {
          tagName: "meta",
          attributes: { name: "seekite-search-url", content: "/handbook/search" },
        },
      ],
    });

    await plugin.postBuild({ outDir, routes: ["/docs"] });
    const corpus = JSON.parse(await readFile(path.join(outDir, "search/docs/corpus.json"), "utf8"));
    expect(corpus).toMatchObject({
      chunks: { filters: { version: ["3.0"], locale: ["en"] } },
      facets: { version: { "3.0": 1 }, locale: { en: 1 } },
    });
  });

  it("server-renders the registered React SearchBar with version and locale facets", () => {
    const client: SearchUIClient = {
      async load() {},
      loaded: () => [],
      async query() {
        return { results: [], total: 0 };
      },
      async warmup() {},
    };
    const markup = renderToStaticMarkup(
      createElement(SeekiteSearchBar, {
        client,
        label: "Search versioned docs",
        onResultSelect: () => undefined,
      }),
    );
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-label="Search versioned docs"');
    expect(markup).toContain("seekite-box");
  });
});
