import { createSearchController } from "../src/controller.js";

export function testController() {
  return createSearchController({
    minLength: 10,
    client: {
      loaded: () => [],
      async load() {},
      async query() {
        return { results: [], total: 0 };
      },
    },
  });
}
