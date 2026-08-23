import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { parseArgs, resolveOutputFiles } from "./run.js";

describe("parseArgs", () => {
  it("parses the documented list and check options", () => {
    const options = parseArgs([
      "--",
      "--datasets=scifact,arguana",
      "--engines",
      "seekite,orama",
      "--candidates",
      "lexical,hybrid",
      "--budget-ms=25",
      "--check",
    ]);
    expect(options).toMatchObject({
      budgetMs: 25,
      candidates: ["lexical", "hybrid"],
      check: true,
      datasets: ["scifact", "arguana"],
      engines: ["seekite", "orama"],
    });
  });

  it("rejects unknown selections", () => {
    expect(() => parseArgs(["--engines", "mystery"])).toThrow("unsupported value");
  });
});

it("uses an explicit JSON output path for deterministic CI artifacts", () => {
  const files = resolveOutputFiles("/tmp/beir-ci.json", "2026-08-23T00:00:00.000Z");
  expect(files).toEqual({ json: "/tmp/beir-ci.json", markdown: "/tmp/beir-ci.md" });
  expect(path.extname(files.json)).toBe(".json");
});

it("writes paired reports inside an explicit CI output directory", () => {
  const files = resolveOutputFiles("/tmp/beir-ci", "2026-08-23T00:00:00.000Z");
  expect(path.dirname(files.json)).toBe("/tmp/beir-ci");
  expect(path.basename(files.json)).toMatch(/^2026-08-23-.+\.json$/);
  expect(files.markdown).toBe(files.json.replace(/\.json$/, ".md"));
});
