import { workerSearch } from "@seekite/core";
import { SearchDialog, SeekiteProvider, useSeekite } from "@seekite/react";
import "@seekite/react/style.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const search = workerSearch(
  () => new Worker(new URL("./search.worker.ts", import.meta.url), { type: "module" }),
);

function SearchTrigger() {
  const [, controller] = useSeekite();
  return (
    <button className="search-trigger" type="button" onClick={() => controller.open()}>
      Search guides <kbd>⌘K</kbd>
    </button>
  );
}

function App() {
  return (
    <main>
      <span>React consumer</span>
      <h1>Framework-independent means exactly that.</h1>
      <p>Search and runtime embeddings run off the main thread. Press ⌘K or Ctrl+K.</p>
      <SearchTrigger />
      <SearchDialog
        placeholder="Try authentication"
        onResultSelect={(result) => window.location.assign(result.url)}
      />
    </main>
  );
}

createRoot(document.querySelector("#root")!).render(
  <StrictMode>
    <SeekiteProvider
      client={search}
      options={{ queryOptions: { corpora: ["guides"], mode: "hybrid", limit: 8 } }}
    >
      <App />
    </SeekiteProvider>
  </StrictMode>,
);
