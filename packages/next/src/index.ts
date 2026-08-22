import { access } from "node:fs/promises";
import path from "node:path";
import {
  runIntegrationBuild,
  type BuildResult,
  type GeneratedHTMLOptions,
  type SearchConfig,
} from "@seekite/build";

export interface SeekiteNextBuildOptions {
  root?: string;
  config?: string | SearchConfig;
  htmlDir?: string;
  outDir?: string;
  assetsDir?: string;
  /** Opt in to indexing Next's semi-internal `.next/server/app` HTML tree. */
  includeNextServer?: boolean;
  html?: Omit<GeneratedHTMLOptions, "directory">;
}

export interface SeekiteNextBuildResult extends BuildResult {
  mode: "export" | "next-server" | "custom";
  htmlDir: string;
}

export interface NextHeaderValue {
  key: string;
  value: string;
}

export interface NextHeaderRule {
  source: string;
  headers: NextHeaderValue[];
}

export interface NextConfigLike {
  headers?: (this: void) => NextHeaderRule[] | Promise<NextHeaderRule[]>;
  [key: string]: unknown;
}

export interface SeekiteNextHeadersOptions {
  assetsDir?: string;
}

function assetsDirectory(value: string | undefined): string {
  const directory = (value ?? "search").replace(/^\/+|\/+$/g, "");
  if (!directory || directory.split(/[\\/]/).includes("..")) {
    throw new Error("Seekite assetsDir must be a relative public directory");
  }
  return directory;
}

async function directoryExists(directory: string): Promise<boolean> {
  return access(directory).then(
    () => true,
    () => false,
  );
}

/** Index a Next static export, or the server HTML tree when explicitly enabled. */
export async function runNextBuild(
  options: SeekiteNextBuildOptions = {},
): Promise<SeekiteNextBuildResult> {
  const root = path.resolve(options.root ?? process.cwd());
  const assetsDir = assetsDirectory(options.assetsDir);
  let mode: SeekiteNextBuildResult["mode"];
  let htmlDir: string;
  let outDir: string;

  if (options.htmlDir) {
    mode = "custom";
    htmlDir = path.resolve(root, options.htmlDir);
    outDir = path.resolve(root, options.outDir ?? path.join("public", assetsDir));
  } else {
    const exportDir = path.join(root, "out");
    const nextServerDir = path.join(root, ".next", "server", "app");
    if (await directoryExists(exportDir)) {
      mode = "export";
      htmlDir = exportDir;
      outDir = path.resolve(root, options.outDir ?? path.join("out", assetsDir));
    } else if (await directoryExists(nextServerDir)) {
      if (!options.includeNextServer) {
        throw new Error(
          "Seekite found .next/server/app, but that layout is a best-effort Next internal. " +
            "Use output: 'export' or pass includeNextServer: true (--next-server).",
        );
      }
      mode = "next-server";
      htmlDir = nextServerDir;
      outDir = path.resolve(root, options.outDir ?? path.join("public", assetsDir));
    } else {
      throw new Error(
        "Seekite could not find Next's out/ export. Run next build with output: 'export', " +
          "or provide htmlDir explicitly.",
      );
    }
  }

  const result = await runIntegrationBuild({
    root,
    htmlDir,
    outDir,
    config: options.config,
    html: options.html,
  });
  return { ...result, mode, htmlDir };
}

/** Add immutable shard headers while keeping the mutable manifest revalidated. */
export function withSeekiteHeaders<T extends NextConfigLike>(
  config: T,
  options?: SeekiteNextHeadersOptions,
): T & { headers(): Promise<NextHeaderRule[]> };
export function withSeekiteHeaders(
  config?: NextConfigLike,
  options?: SeekiteNextHeadersOptions,
): NextConfigLike & { headers(): Promise<NextHeaderRule[]> };
export function withSeekiteHeaders(
  config: NextConfigLike = {},
  options: SeekiteNextHeadersOptions = {},
): NextConfigLike & { headers(): Promise<NextHeaderRule[]> } {
  const assetsDir = assetsDirectory(options.assetsDir);
  const base = `/${assetsDir}`;
  return {
    ...config,
    async headers() {
      const existing = (await config.headers?.()) ?? [];
      return [
        ...existing,
        {
          source: `${base}/:path*`,
          headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
        },
        {
          source: `${base}/manifest.json`,
          headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
        },
      ];
    },
  };
}
