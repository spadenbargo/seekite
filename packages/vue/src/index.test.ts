// @vitest-environment jsdom
import { createApp, h, nextTick } from "vue";
import { expect, it } from "vite-plus/test";
import { testController } from "../../search-ui/test/controller.js";
import { useSearchState } from "./index.js";

it("updates mounted views and releases their subscription on unmount", async () => {
  const controller = testController();
  let state!: ReturnType<typeof useSearchState>;
  const app = createApp({
    setup() {
      state = useSearchState(controller);
      return () => h("span", state.value.query);
    },
  });
  const host = document.createElement("div");
  app.mount(host);
  controller.setQuery("first");
  await nextTick();
  expect(host.textContent).toBe("first");
  app.unmount();
  controller.setQuery("second");
  expect(state.value.query).toBe("first");
  controller.destroy();
});
