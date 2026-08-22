import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { loadSearchConfig, runIntegrationBuild } from "./integration.js";

async function renderedSite(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "seekite-integration-"));
  await mkdir(path.join(root, "site", "guide"), { recursive: true });
  await writeFile(
    path.join(root, "site", "guide", "index.html"),
    `<html lang="en"><head><title>Guide</title></head><body><main><h1>Guide</h1><p>Searchable integration output.</p></main></body></html>`,
  );
  return root;
}

describe("integration build contract", () => {
  it("loads a TypeScript config through the shared loader", async () => {
    const root = await renderedSite();
    await writeFile(
      path.join(root, "search.config.ts"),
      `export default { corpora: { guides: { include: ["/guide/**"] } } }`,
    );

    const config = await loadSearchConfig({ root });
    expect(Object.keys(config.corpora)).toEqual(["guides"]);
  });

  it("indexes generated HTML by default and applies adapter facet defaults", async () => {
    const root = await renderedSite();
    const result = await runIntegrationBuild({
      root,
      htmlDir: "site",
      outDir: "public/search",
      corpusDefaults: { filters: ["locale"], facets: ["locale"] },
    });

    expect(result.corpora.docs).toMatchObject({ documents: 1, chunks: 1 });
    const corpus = JSON.parse(
      await readFile(path.join(root, "public/search/docs/corpus.json"), "utf8"),
    );
    expect(corpus).toMatchObject({
      chunks: { filters: { locale: ["en"] } },
      facets: { locale: { en: 1 } },
    });
  });
});
