import path from "node:path";
import {
  runIntegrationBuild,
  type CorpusConfig,
  type GeneratedHTMLOptions,
  type SearchConfig,
} from "@seekite/build";
import { seekite as seekiteVite } from "@seekite/vite";
import type { SiteConfig, UserConfig } from "vitepress";

export type VitePressLocales = string[] | Record<string, unknown>;

export interface SeekiteVitePressOptions {
  config?: string | SearchConfig;
  indexing?: "vite" | "external";
  assetsDir?: string;
  /** Locale keys from VitePress's `locales` config. */
  locales?: VitePressLocales;
  html?: Omit<GeneratedHTMLOptions, "directory">;
}

export interface VitePressPluginLike {
  name: string;
  enforce?: "pre" | "post";
}

const VITEPRESS_BODY_SELECTORS = [
  "[data-seekite-body]",
  ".VPDoc .vp-doc",
  ".vp-doc",
  "main",
  "article",
];

function localeKeys(locales: VitePressLocales): string[] {
  return Array.isArray(locales) ? locales : Object.keys(locales);
}

function corpusName(locale: string): string {
  const name = locale.replace(/[\\/]/g, "-").trim();
  if (!name || name === "." || name === "..")
    throw new Error(`Invalid VitePress locale: ${locale}`);
  return name;
}

/** Build one route-filtered corpus per configured VitePress locale. */
export function vitePressLocaleConfig(locales: VitePressLocales): SearchConfig {
  const keys = localeKeys(locales);
  const nonRoot = keys.filter((locale) => locale !== "root");
  const corpora: Record<string, CorpusConfig> = {};
  for (const locale of keys) {
    const name = corpusName(locale);
    if (corpora[name]) throw new Error(`VitePress locales produce duplicate corpus ${name}`);
    corpora[name] =
      locale === "root"
        ? {
            exclude: nonRoot.flatMap((entry) => [`/${entry}`, `/${entry}/**`]),
            filters: ["locale"],
            facets: ["locale"],
          }
        : {
            include: [`/${locale}`, `/${locale}/**`],
            filters: ["locale"],
            facets: ["locale"],
          };
  }
  return { corpora };
}

/** VitePress-aware wrapper around `@seekite/vite`. */
export function seekite(options: SeekiteVitePressOptions = {}): VitePressPluginLike {
  const config =
    options.config ?? (options.locales ? vitePressLocaleConfig(options.locales) : undefined);
  return seekiteVite({
    config,
    indexing: options.indexing,
    assetsDir: options.assetsDir,
    html: {
      bodySelector: VITEPRESS_BODY_SELECTORS,
      ...options.html,
    },
  });
}

function assetsDirectory(value: string | undefined): string {
  const directory = (value ?? "search").replace(/^\/+|\/+$/g, "");
  if (!directory || directory.split(/[\\/]/).includes("..")) {
    throw new Error("Seekite assetsDir must stay inside VitePress's output directory");
  }
  return directory;
}

/**
 * Add Seekite to a VitePress config. VitePress renders HTML after Vite's
 * `closeBundle`, so indexing runs in VitePress's own `buildEnd` hook while the
 * Vite plugin continues to serve generated artifacts in development.
 */
export function withSeekite<ThemeConfig>(
  config: UserConfig<ThemeConfig>,
  options: SeekiteVitePressOptions = {},
): UserConfig<ThemeConfig> {
  const locales = options.locales ?? config.locales;
  const searchConfig = options.config ?? (locales ? vitePressLocaleConfig(locales) : undefined);
  const vitePlugin = seekiteVite({
    config: searchConfig,
    indexing: options.indexing,
    assetsDir: options.assetsDir,
    html: {
      bodySelector: VITEPRESS_BODY_SELECTORS,
      ...options.html,
    },
  });
  const plugin =
    options.indexing === "external" ? vitePlugin : { ...vitePlugin, closeBundle: undefined };
  const previousBuildEnd = config.buildEnd;

  return {
    ...config,
    vite: {
      ...config.vite,
      plugins: [...(config.vite?.plugins ?? []), plugin],
    },
    async buildEnd(siteConfig: SiteConfig) {
      await previousBuildEnd?.(siteConfig);
      if (options.indexing === "external") return;
      const assetsDir = assetsDirectory(options.assetsDir);
      await runIntegrationBuild({
        root: siteConfig.root,
        htmlDir: siteConfig.outDir,
        outDir: path.join(siteConfig.outDir, assetsDir),
        config: searchConfig,
        html: {
          bodySelector: VITEPRESS_BODY_SELECTORS,
          ...options.html,
        },
      });
    },
  };
}

export default seekite;
