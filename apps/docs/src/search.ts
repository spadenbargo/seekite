import { workerSearch } from "@seekite/core";

export const docsSearch = workerSearch(
  () => new Worker(new URL("./search.worker.ts", import.meta.url), { type: "module" }),
);
