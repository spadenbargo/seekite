import { access } from "node:fs/promises";
import path from "node:path";
import { createJiti } from "jiti";
import { buildSearch } from "./build.js";
import { generatedHTML, type GeneratedHTMLOptions } from "./sources.js";
import type { BuildResult, CorpusConfig, SearchConfig } from "./types.js";

const DEFAULT_CONFIG_FILE = "search.config.ts";

export type SearchConfigInput = string | SearchConfig;

export interface LoadSearchConfigOptions {
  root?: string;
  config?: SearchConfigInput;
}

export interface IntegrationBuildOptions {
  root?: string;
  /** Rendered HTML directory, absolute or relative to `root`. */
  htmlDir: string;
  /** Search artifact directory. Defaults to `<htmlDir>/search`. */
  outDir?: string;
  /** Config object or config path. An existing `search.config.ts` is automatic. */
  config?: SearchConfigInput;
  /** HTML extraction defaults applied to corpora without an explicit source. */
  html?: Omit<GeneratedHTMLOptions, "directory">;
  /** Adapter metadata defaults, such as Docusaurus version/locale facets. */
  corpusDefaults?: Pick<CorpusConfig, "filters" | "facets">;
}

function isSearchConfig(value: unknown): value is SearchConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "corpora" in value &&
    typeof value.corpora === "object" &&
    value.corpora !== null
  );
}

/** Load TypeScript, JavaScript, ESM, or CommonJS search config through jiti. */
export async function loadSearchConfig(
  options: LoadSearchConfigOptions = {},
): Promise<SearchConfig> {
  if (options.config && typeof options.config !== "string") return options.config;
  const root = path.resolve(options.root ?? process.cwd());
  const configPath = path.resolve(root, options.config ?? DEFAULT_CONFIG_FILE);
  const jiti = createJiti(import.meta.url, { moduleCache: false, interopDefault: true });
  const loaded: unknown = await jiti.import(configPath, { default: true });
  if (!isSearchConfig(loaded)) {
    throw new TypeError(`Seekite config ${configPath} must export an object with a corpora map`);
  }
  return loaded;
}

function withIntegrationDefaults(
  config: SearchConfig,
  htmlDir: string,
  html: IntegrationBuildOptions["html"],
  defaults: IntegrationBuildOptions["corpusDefaults"],
): SearchConfig {
  const corpora = Object.fromEntries(
    Object.entries(config.corpora).map(([name, corpus]): [string, CorpusConfig] => [
      name,
      {
        ...corpus,
        source: corpus.source ?? generatedHTML({ directory: htmlDir, ...html }),
        filters: corpus.filters ?? defaults?.filters,
        facets: corpus.facets ?? defaults?.facets,
      },
    ]),
  );
  return { ...config, corpora };
}

async function defaultConfigExists(root: string): Promise<boolean> {
  return access(path.join(root, DEFAULT_CONFIG_FILE)).then(
    () => true,
    () => false,
  );
}

/**
 * Shared postbuild contract for framework adapters. A project config wins when
 * present; otherwise a single `docs` corpus indexes the rendered HTML tree.
 */
export async function runIntegrationBuild(options: IntegrationBuildOptions): Promise<BuildResult> {
  const root = path.resolve(options.root ?? process.cwd());
  const htmlDir = path.resolve(root, options.htmlDir);
  const config =
    options.config !== undefined || (await defaultConfigExists(root))
      ? await loadSearchConfig({ root, config: options.config })
      : ({ corpora: { docs: {} } } satisfies SearchConfig);
  const resolved = withIntegrationDefaults(config, htmlDir, options.html, options.corpusDefaults);
  const outputDir = options.outDir
    ? path.resolve(root, options.outDir)
    : resolved.output
      ? undefined
      : path.join(htmlDir, "search");

  return buildSearch(resolved, {
    root,
    generatedDir: htmlDir,
    outputDir,
  });
}
