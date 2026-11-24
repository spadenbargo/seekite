import type { SearchController, SearchUIState } from "@seekite/search-ui";
import { DestroyRef, inject, signal, type Signal } from "@angular/core";
export function injectSearchState(controller: SearchController): Signal<SearchUIState> {
  const lifetime = inject(DestroyRef);
  const state = signal(controller.getState());
  lifetime.onDestroy(controller.subscribe(() => state.set(controller.getState())));
  return state.asReadonly();
}
