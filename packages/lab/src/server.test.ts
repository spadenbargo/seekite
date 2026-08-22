import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { serveLab } from "./server.js";

describe("lab server", () => {
  it("serves the SPA and persists curated judgments", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "seekite-lab-server-"));
    const server = await serveLab({
      root,
      port: 0,
      config: {
        corpora: { docs: { source: [{ id: "a", url: "/a", title: "A", content: "Alpha" }] } },
        bench: { candidates: { default: {} }, queries: "bench/queries.jsonl" },
      },
    });
    try {
      const page = await fetch(server.url);
      expect(page.status).toBe(200);
      const markup = await page.text();
      expect(markup).toContain("Seekite lab");
      expect(markup).toContain("Compare candidates");
      expect(markup).toContain("Save judgments");
      expect(markup).toContain('class="relevance"');
      const saved = await fetch(`${server.url}/api/judgments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ judgments: [{ query: "alpha", relevant: ["a"] }] }),
      });
      expect(saved.status).toBe(200);
      expect(await readFile(path.join(root, "bench/queries.jsonl"), "utf8")).toBe(
        '{"query":"alpha","relevant":["a"]}\n',
      );
    } finally {
      await server.close();
    }
  });
});
