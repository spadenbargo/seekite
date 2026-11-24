import type { SearchController, SearchUIState } from "@seekite/search-ui";
import { createSignal, getOwner, onCleanup, type Accessor } from "solid-js";
export function createSearchState(controller: SearchController): Accessor<SearchUIState> {
  if (!getOwner()) throw new Error("Call createSearchState inside a Solid owner");
  const [state, setState] = createSignal(controller.getState());
  onCleanup(controller.subscribe(() => setState(controller.getState())));
  return state;
}
