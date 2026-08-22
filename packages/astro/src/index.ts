import { fileURLToPath } from "node:url";
import path from "node:path";
import { runIntegrationBuild, type GeneratedHTMLOptions, type SearchConfig } from "@seekite/build";
import { seekite as seekiteVite } from "@seekite/vite";

export interface SeekiteAstroOptions {
  config?: string | SearchConfig;
  assetsDir?: string;
  html?: Omit<GeneratedHTMLOptions, "directory">;
}

export interface AstroIntegrationLike {
  name: string;
  hooks: {
    "astro:config:setup"(context: {
      command: string;
      config: { root: URL | string };
      updateConfig(config: Record<string, unknown>): void;
    }): void;
    "astro:build:done"(context: { dir: URL | string }): Promise<void>;
  };
}

function filesystemPath(value: URL | string): string {
  return value instanceof URL ? fileURLToPath(value) : path.resolve(value);
}

function assetsDirectory(value: string | undefined): string {
  const directory = (value ?? "search").replace(/^\/+|\/+$/g, "");
  if (!directory || directory.split(/[\\/]/).includes("..")) {
    throw new Error("Seekite assetsDir must stay inside Astro's output directory");
  }
  return directory;
}

/** Astro integration: Vite-backed indexing in dev and one HTML pass after build. */
export function seekite(options: SeekiteAstroOptions = {}): AstroIntegrationLike {
  const assetsDir = assetsDirectory(options.assetsDir);
  let root = process.cwd();

  return {
    name: "@seekite/astro",
    hooks: {
      "astro:config:setup"(context) {
        root = filesystemPath(context.config.root);
        if (context.command !== "dev") return;
        context.updateConfig({
          vite: {
            plugins: [
              seekiteVite({
                config: options.config,
                indexing: "vite",
                assetsDir,
                html: options.html,
              }),
            ],
          },
        });
      },
      async "astro:build:done"({ dir }) {
        const htmlDir = filesystemPath(dir);
        await runIntegrationBuild({
          root,
          htmlDir,
          outDir: path.join(htmlDir, assetsDir),
          config: options.config,
          html: {
            bodySelector: ["[data-seekite-body]", ".sl-markdown-content", "main", "article"],
            ...options.html,
          },
        });
      },
    },
  };
}

export default seekite;
