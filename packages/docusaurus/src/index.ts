import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { GeneratedHTMLOptions, SearchConfig } from "@seekite/build";
import { SEEKITE_URL_META_NAME } from "./constants.js";

type BuildModule = typeof import("@seekite/build");

function isBuildModuleLoader(value: unknown): value is () => Promise<BuildModule> {
  return typeof value === "function";
}

function requireNativeBuildModuleLoader(): () => Promise<BuildModule> {
  const loader: unknown = createRequire(import.meta.url)("../load-build.cjs");
  if (!isBuildModuleLoader(loader)) {
    throw new TypeError("@seekite/docusaurus could not load its build integration");
  }
  return loader;
}

const nativeBuildModuleLoader = requireNativeBuildModuleLoader();

async function loadBuildModule(): Promise<BuildModule> {
  try {
    return await import("@seekite/build");
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? Reflect.get(error, "code")
        : undefined;
    if (code !== "ERR_PACKAGE_PATH_NOT_EXPORTED" && code !== "ERR_REQUIRE_ESM") throw error;
    return nativeBuildModuleLoader();
  }
}

export interface SeekiteDocusaurusOptions {
  config?: string | SearchConfig;
  assetsDir?: string;
  html?: Omit<GeneratedHTMLOptions, "directory">;
}

export interface DocusaurusContextLike {
  siteDir: string;
  baseUrl?: string;
}

export interface DocusaurusPluginLike {
  name: string;
  getThemePath(): string;
  injectHtmlTags(): {
    headTags: Array<{
      tagName: string;
      attributes: Record<string, string>;
    }>;
  };
  postBuild(context: { outDir: string; routes?: unknown[] }): Promise<void>;
}

function assetsDirectory(value: string | undefined): string {
  const directory = (value ?? "search").replace(/^\/+|\/+$/g, "");
  if (!directory || directory.split(/[\\/]/).includes("..")) {
    throw new Error("Seekite assetsDir must stay inside Docusaurus's output directory");
  }
  return directory;
}

function assetURL(baseUrl: string | undefined, assetsDir: string): string {
  const base = (baseUrl ?? "/").replace(/^\/+|\/+$/g, "");
  return `/${[base, assetsDir].filter(Boolean).join("/")}`;
}

/** Docusaurus plugin using its stable `postBuild` rendered-output lifecycle. */
export default function seekiteDocusaurus(
  context: DocusaurusContextLike,
  options: SeekiteDocusaurusOptions = {},
): DocusaurusPluginLike {
  const assetsDir = assetsDirectory(options.assetsDir);
  return {
    name: "@seekite/docusaurus",
    getThemePath() {
      return fileURLToPath(new URL("../theme", import.meta.url));
    },
    injectHtmlTags() {
      return {
        headTags: [
          {
            tagName: "meta",
            attributes: {
              name: SEEKITE_URL_META_NAME,
              content: assetURL(context.baseUrl, assetsDir),
            },
          },
        ],
      };
    },
    async postBuild({ outDir }) {
      const { runIntegrationBuild } = await loadBuildModule();
      await runIntegrationBuild({
        root: context.siteDir,
        htmlDir: outDir,
        outDir: path.join(outDir, assetsDir),
        config: options.config,
        html: {
          bodySelector: [
            "[data-seekite-body]",
            ".theme-doc-markdown",
            "main article",
            "main",
            "article",
          ],
          ...options.html,
        },
        corpusDefaults: {
          filters: ["version", "locale"],
          facets: ["version", "locale"],
        },
      });
    },
  };
}

export { seekiteDocusaurus };
