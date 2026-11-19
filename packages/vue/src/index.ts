import type { SearchController, SearchUIState } from "@seekite/search-ui";
import { getCurrentInstance, onMounted, onBeforeUnmount, shallowRef, type ShallowRef } from "vue";

export function useSearchState(controller: SearchController): Readonly<ShallowRef<SearchUIState>> {
  if (!getCurrentInstance()) throw new Error("Call useSearchState during Vue component setup");
  const state = shallowRef(controller.getState());
  let unsubscribe: (() => void) | undefined;
  onMounted(() => {
    const update = () => {
      state.value = controller.getState();
    };
    unsubscribe = controller.subscribe(update);
    update();
  });
  onBeforeUnmount(() => unsubscribe?.());
  return state;
}
