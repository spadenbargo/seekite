import { useMemo, useSyncExternalStore } from "react";
import type { SearchController, SearchUIState } from "@seekite/search-ui";

export function useSearchState(controller: SearchController): SearchUIState {
  const store = useMemo(
    () => ({
      subscribe: (listener: () => void) => controller.subscribe(listener),
      snapshot: () => controller.getState(),
    }),
    [controller],
  );
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}
