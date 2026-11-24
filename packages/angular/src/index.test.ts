import { Injector, runInInjectionContext } from "@angular/core";
import { expect, it } from "vite-plus/test";
import { testController } from "../../search-ui/test/controller.js";
import { injectSearchState } from "./index.js";

it("updates the signal until its injector is destroyed", () => {
  const controller = testController();
  const injector = Injector.create({ providers: [] });
  const state = runInInjectionContext(injector, () => injectSearchState(controller));
  controller.setQuery("first");
  expect(state().query).toBe("first");
  injector.destroy();
  controller.setQuery("second");
  expect(state().query).toBe("first");
  controller.destroy();
});
