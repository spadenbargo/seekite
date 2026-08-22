import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type SeekiteTemplate = "vanilla" | "react";

export interface ScaffoldOptions {
  /** Target directory, resolved relative to cwd. */
  target: string;
  template?: SeekiteTemplate;
  cwd?: string;
  packageManager?: "pnpm" | "npm" | "yarn" | "bun";
}

export interface ScaffoldResult {
  directory: string;
  template: SeekiteTemplate;
  files: string[];
}

const commonFiles = (name: string): Record<string, string> => ({
  ".gitignore": "node_modules\ndist\n.seekite\n",
  "index.html": `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${name}</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.ts"></script></body>
</html>
`,
  "content/welcome.md": `---
title: Welcome
section: Guides
---

# Welcome to ${name}

Seekite builds a static hybrid-search index during your Vite build. Edit this
file, then search for words from it in the app.
`,
  "search.config.ts": `import { seekiteEmbeddings } from "@seekite/embeddings-ternlight"
import { defineSearch, staticVectors } from "seekite"

export default defineSearch({
  corpora: {
    docs: {
      source: "./content/**/*.md",
      vectors: staticVectors(seekiteEmbeddings()),
      filters: ["section"],
      facets: ["section"],
      lang: "en",
    },
  },
})
`,
  "src/search.worker.ts": `import { createSearch, exposeSearch } from "@seekite/core"
import { seekiteEmbeddings } from "@seekite/embeddings-ternlight"

exposeSearch(createSearch({ key: "search", embeddings: seekiteEmbeddings() }))
`,
  "src/style.css": `:root { color: #18211f; background: #f5f8f6; font: 16px/1.5 system-ui, sans-serif; }
body { margin: 0; }
main { box-sizing: border-box; width: min(48rem, 100%); margin: 0 auto; padding: 4rem 1.25rem; }
input { box-sizing: border-box; width: 100%; padding: .8rem 1rem; border: 1px solid #9caaa5; border-radius: .65rem; font: inherit; }
li { margin-block: 1rem; }
mark { background: #d9f99d; }
`,
  "vite.config.ts": `import { seekite } from "@seekite/vite"
import { defineConfig } from "vite"

export default defineConfig({
  worker: { format: "es" },
  plugins: [seekite()],
})
`,
  "tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"]
  },
  "include": ["src", "search.config.ts", "vite.config.ts"]
}
`,
});

const vanillaFiles = (name: string): Record<string, string> => ({
  ...commonFiles(name),
  "package.json": `${JSON.stringify(
    {
      name,
      private: true,
      version: "0.0.0",
      type: "module",
      scripts: { dev: "vite", build: "tsc && vite build", preview: "vite preview" },
      dependencies: {
        "@seekite/core": "^0.1.0-alpha.0",
        "@seekite/embeddings-ternlight": "^0.1.0-alpha.0",
        "@seekite/search-ui": "^0.1.0-alpha.0",
      },
      devDependencies: {
        "@seekite/vite": "^0.1.0-alpha.0",
        seekite: "^0.1.0-alpha.0",
        typescript: "^7.0.0",
        vite: "^8.2.0",
      },
    },
    undefined,
    2,
  )}\n`,
  "src/main.ts": `import { workerSearch } from "@seekite/core"
import { createSearchController } from "@seekite/search-ui"
import "./style.css"

const client = workerSearch(() => new Worker(new URL("./search.worker.ts", import.meta.url), { type: "module" }))
const controller = createSearchController({ client, queryOptions: { corpora: ["docs"], facets: ["section"] } })
const root = document.querySelector<HTMLDivElement>("#root")!

root.innerHTML = '<main><p>Seekite starter</p><h1>Search your content locally</h1><input id="query" placeholder="Try welcome" aria-label="Search" /><ol id="results"></ol></main>'
const input = root.querySelector<HTMLInputElement>("#query")!
const results = root.querySelector<HTMLOListElement>("#results")!

controller.subscribe(() => {
  const state = controller.getState()
  results.replaceChildren(...(state.response?.results ?? []).map((result) => {
    const item = document.createElement("li")
    const link = document.createElement("a")
    link.href = result.url
    link.textContent = result.heading || result.title
    const excerpt = document.createElement("p")
    excerpt.textContent = controller.snippetFor(result).text
    item.append(link, excerpt)
    return item
  }))
})
input.addEventListener("focus", () => controller.open())
input.addEventListener("input", () => controller.setQuery(input.value))
`,
});

const reactFiles = (name: string): Record<string, string> => {
  const files = commonFiles(name);
  files["index.html"] = files["index.html"]!.replace("/src/main.ts", "/src/main.tsx");
  files["package.json"] = `${JSON.stringify(
    {
      name,
      private: true,
      version: "0.0.0",
      type: "module",
      scripts: { dev: "vite", build: "tsc && vite build", preview: "vite preview" },
      dependencies: {
        "@seekite/core": "^0.1.0-alpha.0",
        "@seekite/embeddings-ternlight": "^0.1.0-alpha.0",
        "@seekite/react": "^0.1.0-alpha.0",
        react: "^19.2.0",
        "react-dom": "^19.2.0",
      },
      devDependencies: {
        "@seekite/vite": "^0.1.0-alpha.0",
        "@types/react": "^19.2.0",
        "@types/react-dom": "^19.2.0",
        "@vitejs/plugin-react": "latest",
        seekite: "^0.1.0-alpha.0",
        typescript: "^7.0.0",
        vite: "^8.2.0",
      },
    },
    undefined,
    2,
  )}\n`;
  files["vite.config.ts"] = `import { seekite } from "@seekite/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  worker: { format: "es" },
  plugins: [react(), seekite()],
})
`;
  files["src/main.tsx"] = `import { workerSearch } from "@seekite/core"
import { SearchDialog, SeekiteProvider } from "@seekite/react"
import "@seekite/react/style.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./style.css"

const client = workerSearch(() => new Worker(new URL("./search.worker.ts", import.meta.url), { type: "module" }))

function App() {
  return <SeekiteProvider client={client} options={{ queryOptions: { corpora: ["docs"], facets: ["section"] } }}>
    <main><p>Seekite starter</p><h1>Search your content locally</h1><p>Press <kbd>⌘K</kbd> or <kbd>Ctrl+K</kbd> to search.</p></main>
    <SearchDialog />
  </SeekiteProvider>
}

createRoot(document.querySelector("#root")!).render(<StrictMode><App /></StrictMode>)
`;
  files["tsconfig.json"] = files["tsconfig.json"]!.replace(
    '"lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"]',
    '"lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],\n    "jsx": "react-jsx"',
  );
  return files;
};

function packageName(targetDirectory: string): string {
  const fallback = "seekite-app";
  const value = path
    .basename(targetDirectory)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");
  return value.replace(/^[._-]+|[._-]+$/g, "") || fallback;
}

async function assertEmpty(directory: string): Promise<void> {
  try {
    const entries = await readdir(directory);
    if (entries.length > 0) throw new Error(`Target directory is not empty: ${directory}`);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
}

export async function scaffoldSeekite(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const target = options.target.trim();
  if (!target) throw new TypeError("A target directory is required");
  const template = options.template ?? "react";
  if (template !== "react" && template !== "vanilla") {
    throw new TypeError(`Unknown template: ${String(template)}`);
  }

  const directory = path.resolve(options.cwd ?? process.cwd(), target);
  await assertEmpty(directory);
  const name = packageName(directory);
  const files = template === "react" ? reactFiles(name) : vanillaFiles(name);
  await mkdir(directory, { recursive: true });
  for (const [relativePath, contents] of Object.entries(files)) {
    const destination = path.join(directory, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents, { encoding: "utf8", flag: "wx" });
  }

  return { directory, template, files: Object.keys(files).sort() };
}
