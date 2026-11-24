import { expect, it } from "vite-plus/test";
import { testController } from "../../search-ui/test/controller.js";
import { searchStore } from "./index.js";

it("delivers the current snapshot on subscription and resubscription", () => {
  const controller = testController();
  const store = searchStore(controller);
  controller.setQuery("first");
  const seen: string[] = [];
  const stop = store.subscribe((state) => seen.push(state.query));
  controller.setQuery("second");
  stop();
  controller.setQuery("third");
  expect(seen).toEqual(["first", "second"]);
  store.subscribe((state) => seen.push(state.query))();
  expect(seen.at(-1)).toBe("third");
  controller.destroy();
});
