import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ENGINE_ADAPTERS } from "./index.js";
import type { BeirDocument, EngineName } from "../types.js";

const documents: BeirDocument[] = [
  { id: "space", title: "Rocket manual", text: "A rocket travels through space." },
  { id: "water", title: "Ocean manual", text: "A submarine travels under water." },
];

describe.each(["seekite", "zbsearch", "orama", "minisearch"] satisfies EngineName[])(
  "%s adapter",
  (engineName) => {
    it("returns original BEIR document ids in relevance order", async () => {
      const directory = await mkdtemp(path.join(tmpdir(), `seekite-beir-${engineName}-test-`));
      try {
        const engine = await ENGINE_ADAPTERS[engineName].build(documents, {
          cacheDirectory: path.join(directory, "cache"),
          candidate: "lexical",
          dataset: "scifact",
          temporaryDirectory: directory,
        });
        expect(await engine.search("rocket space", 100)).toEqual(expect.arrayContaining(["space"]));
        expect((await engine.search("rocket space", 100))[0]).toBe("space");
        await engine.dispose?.();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  },
);
