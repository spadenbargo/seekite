import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { seekite } from "./index.js";

describe("Astro integration", () => {
  it("injects the Vite plugin in dev and indexes the completed build", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "seekite-astro-"));
    const dist = path.join(root, "dist");
    await mkdir(dist, { recursive: true });
    await writeFile(
      path.join(dist, "index.html"),
      `<main class="sl-markdown-content"><h1>Astro guide</h1><p>Build-time search.</p></main>`,
    );
    const integration = seekite();
    let update: Record<string, unknown> | undefined;

    integration.hooks["astro:config:setup"]({
      command: "dev",
      config: { root },
      updateConfig(config) {
        update = config;
      },
    });
    expect(update).toMatchObject({ vite: { plugins: [{ name: "seekite" }] } });

    await integration.hooks["astro:build:done"]({ dir: dist });
    const manifest = JSON.parse(await readFile(path.join(dist, "search/manifest.json"), "utf8"));
    expect(manifest.corpora.docs.chunks).toBe(1);
  });
});
