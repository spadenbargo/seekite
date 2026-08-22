import { createSearch, type QueryOptions, type SearchClient } from "@seekite/core";
import {
  SearchBox,
  SeekiteProvider,
  type ResultSelectHandler,
  type SearchUIClient,
} from "@seekite/react";
import { useMemo } from "react";
import { SEEKITE_URL_META_NAME } from "./constants.js";

export { SEEKITE_URL_META_NAME } from "./constants.js";

export interface DocusaurusSearchClientOptions {
  url?: string;
  assetKey?: string;
}

function browserSearchURL(assetKey: string): string {
  if (typeof document !== "undefined") {
    const configured = document
      .querySelector<HTMLMetaElement>(`meta[name="${SEEKITE_URL_META_NAME}"]`)
      ?.content.trim();
    if (configured) return configured;
  }
  return `/${assetKey.replace(/^\/+|\/+$/g, "") || "search"}`;
}

/**
 * Defer manifest URL discovery until the first interaction. This keeps SSR pure
 * while allowing the Docusaurus plugin's baseUrl-aware meta tag to drive fetches.
 */
export function createDocusaurusSearchClient(
  options: DocusaurusSearchClientOptions = {},
): SearchUIClient {
  let client: SearchClient | undefined;
  const resolve = (): SearchClient => {
    client ??= createSearch({
      url: options.url ?? browserSearchURL(options.assetKey ?? "search"),
    });
    return client;
  };
  return {
    load: (corpus) => resolve().load(corpus),
    loaded: () => client?.loaded() ?? [],
    query: (query, queryOptions) => resolve().query(query, queryOptions),
    warmup: async () => {
      await resolve().warmup?.();
    },
  };
}

export interface SeekiteSearchBarProps {
  client?: SearchUIClient;
  url?: string;
  assetKey?: string;
  corpora?: string[];
  facets?: string[];
  queryOptions?: QueryOptions;
  label?: string;
  placeholder?: string;
  showFacets?: boolean;
  onResultSelect?: ResultSelectHandler;
  className?: string;
}

/** Docusaurus `@theme/SearchBar` implementation using the shared React primitives. */
export function SeekiteSearchBar({
  client: providedClient,
  url,
  assetKey = "search",
  corpora,
  facets = ["version", "locale"],
  queryOptions,
  label = "Search documentation",
  placeholder = "Search docs…",
  showFacets = true,
  onResultSelect,
  className,
}: SeekiteSearchBarProps) {
  const client = useMemo(
    () => providedClient ?? createDocusaurusSearchClient({ url, assetKey }),
    [assetKey, providedClient, url],
  );
  const providerOptions = useMemo(
    () => ({
      queryOptions: {
        ...queryOptions,
        ...(corpora?.length ? { corpora: [...corpora] } : {}),
        ...(facets.length ? { facets: [...facets] } : {}),
      },
      recentStorageKey: "seekite:docusaurus:recent",
    }),
    [corpora, facets, queryOptions],
  );
  const select: ResultSelectHandler =
    onResultSelect ?? ((result) => globalThis.location?.assign(result.url));

  return (
    <SeekiteProvider client={client} options={providerOptions}>
      <SearchBox
        className={className}
        label={label}
        placeholder={placeholder}
        showFacets={showFacets}
        onResultSelect={select}
      />
    </SeekiteProvider>
  );
}

export default SeekiteSearchBar;
