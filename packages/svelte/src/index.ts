import type { SearchController, SearchUIState } from "@seekite/search-ui";
import { readable, type Readable } from "svelte/store";
export function searchStore(controller: SearchController): Readable<SearchUIState> {
  return readable(controller.getState(), (set) => {
    const update = () => set(controller.getState());
    const unsubscribe = controller.subscribe(update);
    update();
    return unsubscribe;
  });
}
