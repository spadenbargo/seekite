import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { parseNextBuildArgs } from "./cli.js";
import { runNextBuild, withSeekiteHeaders } from "./index.js";

describe("Next integration", () => {
  it("detects a static export and writes deployable assets into out", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "seekite-next-"));
    await mkdir(path.join(root, "out", "guide"), { recursive: true });
    await writeFile(
      path.join(root, "out", "guide", "index.html"),
      `<main><h1>Next guide</h1><p>Exported documentation.</p></main>`,
    );

    const result = await runNextBuild({ root });
    expect(result.mode).toBe("export");
    const manifest = JSON.parse(
      await readFile(path.join(root, "out/search/manifest.json"), "utf8"),
    );
    expect(manifest.corpora.docs.chunks).toBe(1);
  });

  it("preserves existing headers and overrides manifest caching after shard caching", async () => {
    const config = withSeekiteHeaders({
      async headers() {
        return [{ source: "/health", headers: [{ key: "x-test", value: "yes" }] }];
      },
    });

    const headers = await config.headers();
    expect(headers.map((rule) => rule.source)).toEqual([
      "/health",
      "/search/:path*",
      "/search/manifest.json",
    ]);
    expect(headers.at(-1)?.headers[0]?.value).toContain("must-revalidate");
  });

  it("requires an explicit opt-in for Next's internal server HTML layout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "seekite-next-server-"));
    await mkdir(path.join(root, ".next/server/app"), { recursive: true });
    await expect(runNextBuild({ root })).rejects.toThrow(/--next-server/);
  });

  it("parses the postbuild command without loading Next itself", () => {
    expect(
      parseNextBuildArgs(["build", "--root", "website", "--assets-dir", "find", "--next-server"]),
    ).toEqual({ root: "website", assetsDir: "find", includeNextServer: true });
  });
});
