import { SearchBox, SearchDialog, SeekiteProvider, useSeekite } from "@seekite/react";
import { useNavigate } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import type {
  FullSearchTriggerProps,
  SearchTriggerProps,
} from "fumadocs-ui/layouts/shared/slots/search-trigger";
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

function SearchButton({
  compact = false,
  className,
  ...props
}: ComponentProps<"button"> & { compact?: boolean }) {
  const [, controller] = useSeekite();
  return (
    <button
      {...props}
      type="button"
      className={["search-trigger", compact && "is-compact", className].filter(Boolean).join(" ")}
      aria-keyshortcuts="Meta+K Control+K"
      onClick={() => controller.open()}
      onFocus={() => void controller.prefetch()}
      onPointerEnter={() => void controller.prefetch()}
    >
      <Search aria-hidden="true" />
      {compact ? null : (
        <>
          <span>Search docs</span>
          <kbd>⌘ K</kbd>
        </>
      )}
    </button>
  );
}

export function CompactSearchTrigger({
  hideIfDisabled: _hideIfDisabled,
  color: _color,
  size: _size,
  ...props
}: SearchTriggerProps) {
  return <SearchButton {...props} compact aria-label="Search docs" />;
}

export function FullSearchTrigger({
  hideIfDisabled: _hideIfDisabled,
  ...props
}: FullSearchTriggerProps) {
  return <SearchButton {...props} />;
}

export function LiveSearch() {
  return (
    <SeekiteProvider client={docsSearch} options={searchOptions}>
      <LiveSearchView />
    </SeekiteProvider>
  );
}

function LiveSearchView() {
  const [state, controller] = useSeekite();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state.open) return undefined;
    const closeFromOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        controller.close();
      }
    };
    document.addEventListener("pointerdown", closeFromOutside);
    return () => document.removeEventListener("pointerdown", closeFromOutside);
  }, [controller, state.open]);

  return (
    <div ref={containerRef} className="live-search">
      <SearchBox
        label="Live documentation search"
        placeholder="Search guides and integrations…"
        showFacets
        inputProps={{
          onKeyDown: (event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            controller.close();
          },
        }}
        onResultSelect={(result) => window.location.assign(result.url)}
      />
      {state.open ? (
        <button type="button" className="live-search-close" onClick={() => controller.close()}>
          <X aria-hidden="true" /> Close search
        </button>
      ) : null}
    </div>
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
