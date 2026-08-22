import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  createSearchController,
  type SearchController,
  type SearchControllerOptions,
  type SearchUIClient,
  type SearchUIState,
} from "@seekite/search-ui";

export type SeekiteResult = NonNullable<SearchUIState["response"]>["results"][number];
export type ResultSelectHandler = (result: SeekiteResult) => void;
export type SeekiteProviderOptions = Omit<SearchControllerOptions, "client">;

export interface SeekiteProviderProps {
  client: SearchUIClient;
  options?: SeekiteProviderOptions;
  children?: ReactNode;
}

export interface SearchView {
  inputId: string;
  listboxId: string;
  liveId: string;
  onResultSelect?: ResultSelectHandler;
}

const ControllerContext = createContext<SearchController | undefined>(undefined);
const ViewContext = createContext<SearchView | undefined>(undefined);

function ids(prefix: string): SearchView {
  return {
    inputId: `${prefix}-input`,
    listboxId: `${prefix}-listbox`,
    liveId: `${prefix}-status`,
  };
}

function safeId(value: string): string {
  return `seekite-${value.replaceAll(":", "")}`;
}

export function SeekiteProvider({ client, options, children }: SeekiteProviderProps) {
  const controller = useMemo(
    () => createSearchController({ ...options, client }),
    [client, options],
  );
  const lifecycle = useRef(0);
  const renderedController = useRef(controller);
  renderedController.current = controller;

  // The deferred generation check avoids destroying the live controller during
  // React Strict Mode's development-only effect setup/cleanup replay.
  useEffect(() => {
    const generation = ++lifecycle.current;
    return () => {
      queueMicrotask(() => {
        if (lifecycle.current === generation || renderedController.current !== controller) {
          controller.destroy();
        }
      });
    };
  }, [controller]);

  const reactId = useId();
  const view = useMemo(() => ids(safeId(reactId)), [reactId]);
  return (
    <ControllerContext.Provider value={controller}>
      <ViewContext.Provider value={view}>{children}</ViewContext.Provider>
    </ControllerContext.Provider>
  );
}

export function useSearchController(): SearchController {
  const controller = useContext(ControllerContext);
  if (!controller) throw new Error("Seekite components must be rendered inside <SeekiteProvider>");
  return controller;
}

export function useSeekite(): readonly [SearchUIState, SearchController] {
  const controller = useSearchController();
  const store = useMemo(
    () => ({
      subscribe: (listener: () => void) => controller.subscribe(listener),
      snapshot: () => controller.getState(),
    }),
    [controller],
  );
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  return useMemo(() => [state, controller] as const, [state, controller]);
}

export function useSearchView(): SearchView {
  const view = useContext(ViewContext);
  if (!view) throw new Error("Seekite components must be rendered inside <SeekiteProvider>");
  return view;
}

export function useScopedSearchView(onResultSelect?: ResultSelectHandler): SearchView {
  const reactId = useId();
  return useMemo(() => ({ ...ids(safeId(reactId)), onResultSelect }), [onResultSelect, reactId]);
}

export function SearchViewProvider({
  value,
  children,
}: {
  value: SearchView;
  children?: ReactNode;
}) {
  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}
