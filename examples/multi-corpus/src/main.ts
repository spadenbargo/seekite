import { createSearch } from "@seekite/core";
import "./style.css";

const search = createSearch({ key: "search" });
const status = document.querySelector("#status")!;
const input = document.querySelector<HTMLInputElement>("#query")!;
const list = document.querySelector<HTMLOListElement>("#results")!;

for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-corpus]")) {
  button.addEventListener("click", async () => {
    await search.load(button.dataset.corpus!);
    button.disabled = true;
    status.textContent = `Loaded: ${search.loaded().join(", ")}`;
  });
}

input.addEventListener("input", async () => {
  const response = await search.query(input.value, { mode: "lexical" });
  list.replaceChildren(
    ...response.results.map((result) => {
      const item = document.createElement("li");
      item.textContent = `[${result.corpus}] ${result.title}: ${result.content}`;
      return item;
    }),
  );
});
