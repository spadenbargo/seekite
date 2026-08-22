import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { scaffoldSeekite } from "./index.js";

describe("scaffoldSeekite", () => {
  it.each(["vanilla", "react"] as const)(
    "creates the %s worker-search starter",
    async (template) => {
      const cwd = await mkdtemp(path.join(tmpdir(), "create-seekite-"));
      const result = await scaffoldSeekite({ cwd, target: "my docs", template });
      const packageJson = JSON.parse(
        await readFile(path.join(result.directory, "package.json"), "utf8"),
      );
      const worker = await readFile(path.join(result.directory, "src/search.worker.ts"), "utf8");
      const viteConfig = await readFile(path.join(result.directory, "vite.config.ts"), "utf8");

      expect(packageJson.name).toBe("my-docs");
      expect(worker).toContain("exposeSearch");
      expect(viteConfig).toContain('worker: { format: "es" }');
      expect(result.files).toContain("search.config.ts");
      expect(result.files).toContain(template === "react" ? "src/main.tsx" : "src/main.ts");
    },
  );

  it("refuses to overwrite a non-empty target", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "create-seekite-"));
    await mkdir(path.join(cwd, "occupied"));
    await scaffoldSeekite({ cwd, target: "occupied", template: "vanilla" });
    await expect(scaffoldSeekite({ cwd, target: "occupied", template: "react" })).rejects.toThrow(
      "not empty",
    );
  });
});
