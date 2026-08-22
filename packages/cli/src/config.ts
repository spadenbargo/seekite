import { loadSearchConfig as loadSharedSearchConfig, type SearchConfig } from "@seekite/build";

export async function loadSearchConfig(
  root: string,
  configFile = "search.config.ts",
): Promise<SearchConfig> {
  return loadSharedSearchConfig({ root, config: configFile });
}
