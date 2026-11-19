import { createRoot } from "solid-js";
import { expect, it } from "vite-plus/test";
import { testController } from "../../search-ui/test/controller.js";
import { createSearchState } from "./index.js";

it("follows the external controller until its Solid owner is disposed", () => {
  const controller = testController();
  createRoot((dispose) => {
    const state = createSearchState(controller);
    controller.setQuery("first");
    expect(state().query).toBe("first");
    dispose();
    controller.setQuery("second");
    expect(state().query).toBe("first");
  });
  controller.destroy();
});
