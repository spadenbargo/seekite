import { type HTMLAttributes, type InputHTMLAttributes } from "react";
import {
  SearchViewProvider,
  useScopedSearchView,
  useSeekite,
  type ResultSelectHandler,
} from "./context.js";
import {
  SearchEmpty,
  SearchFacets,
  SearchInput,
  SearchLoadMore,
  SearchResults,
} from "./primitives.js";

function classes(...values: Array<string | undefined | false>): string | undefined {
  const value = values.filter(Boolean).join(" ");
  return value || undefined;
}

export interface SearchBoxProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  label?: string;
  placeholder?: string;
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, "defaultValue" | "value">;
  onResultSelect?: ResultSelectHandler;
  showFacets?: boolean;
}

export function SearchBox({
  label = "Search",
  placeholder = "Search…",
  inputProps,
  onResultSelect,
  showFacets = true,
  className,
  ...props
}: SearchBoxProps) {
  const [state, controller] = useSeekite();
  const select: ResultSelectHandler = (result) => {
    onResultSelect?.(result);
    controller.close();
  };
  const view = useScopedSearchView(select);

  return (
    <SearchViewProvider value={view}>
      <div
        {...props}
        className={classes("seekite-root", "seekite-box", className)}
        data-status={state.status}
      >
        <SearchInput
          {...inputProps}
          aria-label={inputProps?.["aria-label"] ?? label}
          placeholder={placeholder}
        />
        {state.open ? (
          <div className="seekite-panel">
            {state.status === "error" ? (
              <p className="seekite-error" role="alert">
                {state.error?.message ?? "Search failed."}
              </p>
            ) : null}
            {showFacets ? <SearchFacets /> : null}
            <SearchEmpty />
            <SearchResults />
            <SearchLoadMore />
          </div>
        ) : null}
      </div>
    </SearchViewProvider>
  );
}
