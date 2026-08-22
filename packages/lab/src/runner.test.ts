import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { bench, readRun } from "./runner.js";

describe("bench runner", () => {
  it("builds candidates through the real runtime and writes a versioned run", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "seekite-lab-test-"));
    const outcome = await bench(
      {
        corpora: {
          docs: {
            source: [
              {
                id: "canvas",
                url: "/canvas",
                title: "Canvas",
                content: "Draw rectangles and circles on a canvas.",
              },
              {
                id: "auth",
                url: "/auth",
                title: "Authentication",
                content: "Configure OAuth callback credentials.",
              },
            ],
            vectors: false,
          },
        },
        bench: {
          corpus: "docs",
          k: 2,
          candidates: { baseline: {}, "large-chunks": { chunk: { maxWords: 400 } } },
        },
      },
      { root, quiet: true },
    );

    expect(outcome.run).toMatchObject({
      version: 1,
      synthetic: true,
      config: { corpus: "docs", k: 2 },
      candidates: {
        baseline: { quality: { lexical: expect.any(Object) } },
        "large-chunks": { quality: { lexical: expect.any(Object) } },
      },
    });
    expect(outcome.run.perQuery.length).toBeGreaterThan(0);
    expect(outcome.run.candidates.baseline?.artifacts.lexicalBytes).toBeGreaterThan(0);
    expect(await readRun(outcome.file)).toEqual(outcome.run);
    expect(JSON.parse(await readFile(outcome.file, "utf8"))).toEqual(outcome.run);
  });

  it("records the host-selected backend for Seekite embeddings", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "seekite-lab-backend-"));
    const provider = {
      id: "seekite:ternlight:mini:v1",
      dimensions: 2,
      async embedDocuments(documents: string[]) {
        return documents.map(() => new Float32Array([1, 0]));
      },
      async embedQuery() {
        return new Float32Array([1, 0]);
      },
    };
    const outcome = await bench(
      {
        corpora: {
          docs: {
            source: [{ id: "one", url: "/one", title: "One", content: "Native backend" }],
            vectors: { mode: "static", provider, quantize: "i8" },
          },
        },
        bench: { candidates: { mini: {} } },
      },
      { root, quiet: true, cold: true, backend: "native" },
    );

    expect(outcome.run.environment.backend).toBe("native");
    expect(outcome.run.candidates.mini?.embed.backend).toBe("native");
  });
});
