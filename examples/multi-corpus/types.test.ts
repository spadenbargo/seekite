import { defineSearch, defineSource } from "seekite";
import { createSearch, exposeSearch, workerSearch, type TypedSearchClient } from "@seekite/core";
import type config from "./search.config";

async function consumer(client: TypedSearchClient<typeof config>) {
  const response = await client.query("install", {
    corpora: ["docs"],
    where: { section: "Guide" },
    facets: ["section"],
  });
  const section: string | undefined = response.results[0]?.metadata?.section;
  // @ts-expect-error Only tools have a platform.
  void response.results[0]?.metadata?.platform;
  // @ts-expect-error Unknown corpus.
  await client.load("blog");
  // @ts-expect-error The section facet belongs to docs.
  await client.query("cli", { corpora: ["tools"], facets: ["section"] });
  // @ts-expect-error Unknown filter.
  await client.query("cli", { corpora: ["docs"], where: { sectoin: "Guide" } });
  // @ts-expect-error Narrowing to one corpus requires selecting it at runtime.
  await client.query<"docs">("install");
  const all = await client.query("install");
  for (const hit of all.results) {
    if (hit.corpus === "tools") {
      const platform: string | undefined = hit.metadata?.platform;
      void platform;
    }
  }
  return section;
}
exposeSearch(createSearch<typeof config>());
void consumer(createSearch<typeof config>());
void consumer(workerSearch<TypedSearchClient<typeof config>>(() => new Worker("worker.js")));
void createSearch().query("dynamic", { corpora: ["any"], where: { key: 123 } });

const dynamic: ReturnType<typeof createSearch> = createSearch();
void dynamic.query("dynamic", { facets: ["any"] });

const asyncConfig = defineSearch({
  corpora: {
    blog: {
      source: defineSource("posts", async () => [
        { id: "1", url: "/post", title: "Post", content: "Text", metadata: { year: 2026 } },
      ]),
      facets: ["year"],
    },
  },
});
async function loaderMetadata() {
  const page = await createSearch<typeof asyncConfig>().query("text");
  const year: number | undefined = page.results[0]?.metadata?.year;
  // @ts-expect-error The loader returns numeric years.
  const wrong: string | undefined = page.results[0]?.metadata?.year;
  return [year, wrong];
}
void loaderMetadata;
