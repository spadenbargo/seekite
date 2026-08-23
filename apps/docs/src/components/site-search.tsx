import { SearchDialog, SeekiteProvider, useSeekite } from "@seekite/react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { docsSearch } from "../search";

const searchOptions = {
  queryOptions: {
    corpora: ["docs"],
    mode: "hybrid" as const,
    facets: ["section"],
    group: "expanded" as const,
    hydrate: true,
    limit: 12,
  },
  minLength: 2,
};

export function DocsSearchProvider({ children }: { children: ReactNode }) {
  return (
    <SeekiteProvider client={docsSearch} options={searchOptions}>
      {children}
      <SiteSearchDialog />
    </SeekiteProvider>
  );
}

export function SearchTrigger() {
  const [, controller] = useSeekite();
  return (
    <button
      type="button"
      className="search-trigger"
      aria-keyshortcuts="Meta+K Control+K"
      onClick={() => controller.open()}
      onFocus={() => void controller.prefetch()}
      onPointerEnter={() => void controller.prefetch()}
    >
      <Search aria-hidden="true" />
      <span>Search docs</span>
      <kbd>⌘ K</kbd>
    </button>
  );
}

function SiteSearchDialog() {
  const navigate = useNavigate();
  return (
    <SearchDialog
      label="Search Seekite documentation"
      placeholder="Search guides, APIs, and integrations…"
      showFacets
      onResultSelect={(result) => void navigate({ href: result.url })}
    />
  );
}
