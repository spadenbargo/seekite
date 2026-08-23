import { expect, it } from "vite-plus/test";
import { uniqueRankedIds } from "./shared.js";

it("deduplicates document ids without disturbing rank order", () => {
  expect(uniqueRankedIds(["a", "a", undefined, "b", "c"], 2)).toEqual(["a", "b"]);
});
