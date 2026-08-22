import { createSearch } from "@seekite/core";
import { seekiteEmbeddings } from "@seekite/embeddings-ternlight";
import { createSearchController } from "@seekite/search-ui";
import "./style.css";

const client = createSearch({ key: "search", embeddings: seekiteEmbeddings() });
const controller = createSearchController({
  client,
  queryOptions: { corpora: ["docs"], mode: "hybrid", limit: 5 },
});
const input = document.querySelector<HTMLInputElement>("#query")!;
const results = document.querySelector<HTMLOListElement>("#results")!;

controller.subscribe(() => {
  const state = controller.getState();
  results.setAttribute("aria-busy", String(state.status === "loading"));
  results.replaceChildren(
    ...(state.response?.results ?? []).map((match) => {
      const item = document.createElement("li");
      const heading = document.createElement("a");
      heading.href = match.url;
      heading.textContent = match.heading || match.title;
      const content = document.createElement("p");
      content.textContent = controller.snippetFor(match).text;
      item.append(heading, content);
      return item;
    }),
  );
});

input.addEventListener("focus", () => controller.open());
input.addEventListener("input", () => controller.setQuery(input.value));
