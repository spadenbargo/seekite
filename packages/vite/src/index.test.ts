import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { seekite } from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Seekite Vite development assets", () => {
  it("rejects configured paths that can leave the public directory", () => {
    expect(() => seekite({ assetsDir: "../outside" })).toThrow(/relative directory/);
    expect(() => seekite({ assetsDir: "search/../../outside" })).toThrow(/relative directory/);
  });

  it("serves in-root assets but refuses encoded traversal requests", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "seekite-vite-security-"));
    temporaryDirectories.push(root);
    const publicDirectory = path.join(root, "public");
    const outputDirectory = path.join(publicDirectory, "search");
    await mkdir(outputDirectory, { recursive: true });

    const plugin = seekite({ config: { corpora: {} } });
    if (
      typeof plugin.configResolved !== "function" ||
      typeof plugin.configureServer !== "function"
    ) {
      throw new TypeError("Seekite hooks must be callable");
    }

    plugin.configResolved({
      command: "serve",
      root,
      publicDir: publicDirectory,
    } as never);

    let middleware:
      | ((
          request: { url?: string },
          response: {
            statusCode: number;
            setHeader(name: string, value: string): void;
            end(contents: Uint8Array): void;
          },
          next: () => void,
        ) => void)
      | undefined;
    await plugin.configureServer({
      middlewares: {
        use(value: typeof middleware) {
          middleware = value;
        },
      },
      watcher: { on: vi.fn() },
      config: { logger: { error: vi.fn() } },
    } as never);
    expect(middleware).toBeTypeOf("function");

    await writeFile(path.join(outputDirectory, "allowed.bin"), "allowed");
    await writeFile(path.join(publicDirectory, "secret.bin"), "secret");

    const served = vi.fn();
    const normalNext = vi.fn();
    middleware?.(
      { url: "/search/allowed.bin" },
      { statusCode: 0, setHeader: vi.fn(), end: served },
      normalNext,
    );
    await vi.waitFor(() => expect(served).toHaveBeenCalledOnce());
    expect(normalNext).not.toHaveBeenCalled();
    expect(String(served.mock.calls[0]?.[0])).toBe("allowed");

    const escaped = vi.fn();
    const traversalNext = vi.fn();
    middleware?.(
      { url: "/search/%2e%2e%2fsecret.bin" },
      { statusCode: 0, setHeader: vi.fn(), end: escaped },
      traversalNext,
    );
    await vi.waitFor(() => expect(traversalNext).toHaveBeenCalledOnce());
    expect(escaped).not.toHaveBeenCalled();
  });
});
