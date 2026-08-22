import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { chunkDocument } from "./chunk.js";
import { generatedHTML } from "./sources.js";

async function fixture(html: string): Promise<{ root: string; directory: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "seekite-html-"));
  const directory = path.join(root, "site", "guide");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "index.html"), html);
  return { root, directory: "site" };
}

describe("generated HTML source", () => {
  it("selects the explicit body, removes chrome and noise, and extracts metadata", async () => {
    const { root, directory } = await fixture(`<!doctype html>
      <html lang="fr-CA"><head>
        <title>Fallback title</title>
        <meta property="og:title" content="Café &amp; APIs">
        <meta property="og:locale" content="fr_CA">
        <meta name="data-seekite-version" content="3.x">
        <meta data-seekite-product="cloud" content="ignored">
      </head><body>
        <nav>Global navigation</nav>
        <main><h1>Wrong nested main</h1></main>
        <section data-seekite-body>
          <h1>Install</h1><p>Useful café instructions.</p>
          <aside>Related links</aside>
          <svg><text>diagram noise</text></svg>
          <math><mi>formula noise</mi></math>
          <p data-seekite-ignore>private draft</p>
          <h2>Configure</h2><p>Set the API key.</p>
        </section>
      </body></html>`);

    const [document] = await generatedHTML(directory).load({ root, generatedDir: "unused" });
    expect(document).toBeDefined();
    expect(document).toMatchObject({
      id: "/guide",
      url: "/guide",
      title: "Café & APIs",
      metadata: {
        locale: "fr_CA",
        lang: "fr-CA",
        version: "3.x",
        product: "cloud",
        sourcePath: "guide/index.html",
      },
    });
    expect(document!.content).toContain("Useful café instructions.");
    expect(document!.content).not.toMatch(/navigation|Related|diagram|formula|private draft/);
    expect(chunkDocument(document).map((chunk) => chunk.heading)).toEqual(["Install", "Configure"]);
  });

  it("supports a custom body and exclusion selector and falls back to h1 titles", async () => {
    const { root, directory } = await fixture(`
      <html><body><div class="content"><h1>Reference</h1>
      <p>Keep this.</p><p class="promo">Remove this.</p></div></body></html>`);
    const [document] = await generatedHTML({
      directory,
      bodySelector: ".content",
      excludeSelectors: [".promo"],
    }).load({ root, generatedDir: "unused" });

    expect(document?.title).toBe("Reference");
    expect(document?.content).toContain("Keep this.");
    expect(document?.content).not.toContain("Remove this.");
  });

  it("honors a declared legacy charset when extracting titles and metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "seekite-html-charset-"));
    await mkdir(path.join(root, "site"), { recursive: true });
    const source = Buffer.from(
      `<html><head><meta charset="windows-1252"><meta name="description" content="R\u00e9sum\u00e9"><title>Caf\u00e9</title></head><body><h1>Caf\u00e9</h1><p>Cr\u00e8me br\u00fbl\u00e9e.</p></body></html>`,
      "latin1",
    );
    await writeFile(path.join(root, "site", "index.html"), source);

    const [document] = await generatedHTML("site").load({ root, generatedDir: "unused" });
    expect(document).toMatchObject({
      title: "Caf\u00e9",
      metadata: { description: "R\u00e9sum\u00e9" },
    });
    expect(document?.content).toContain("Cr\u00e8me br\u00fbl\u00e9e.");
  });
});
