import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { seekite } from "@seekite/vite";
import { defineConfig } from "vite-plus";

const appDirectory = fileURLToPath(new URL(".", import.meta.url));
const docsDirectory = path.resolve(appDirectory, "../../docs");

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(absolute);
    return entry.isFile() && entry.name.endsWith(".md") ? [absolute] : [];
  });
}

const documentationPages = markdownFiles(docsDirectory).map((file) => ({
  path: `/docs/${path.relative(docsDirectory, file).split(path.sep).join("/").replace(/\.md$/, "")}`,
  prerender: { enabled: true },
}));

export default defineConfig({
  server: { port: 3000 },
  resolve: { tsconfigPaths: true },
  build: { target: "es2022" },
  worker: { format: "es" },
  plugins: [
    tailwindcss(),
    tanstackStart({
      pages: [
        { path: "/", prerender: { enabled: true } },
        { path: "/playground", prerender: { enabled: true } },
        ...documentationPages,
      ],
      prerender: {
        enabled: true,
        autoStaticPathsDiscovery: true,
        autoSubfolderIndex: true,
        crawlLinks: true,
        failOnError: true,
      },
      spa: {
        enabled: true,
        maskPath: "/__seekite-spa-shell",
        prerender: { enabled: true, outputPath: "/_shell", crawlLinks: false },
      },
    }),
    viteReact(),
    seekite({ config: "search.config.ts", indexing: "vite", assetsDir: "search" }),
  ],
});
