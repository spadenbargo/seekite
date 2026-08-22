import { readFile } from "node:fs/promises";
import path from "node:path";
import { seekiteEmbeddings } from "@seekite/embeddings-ternlight";
import matter from "gray-matter";
import { marked } from "marked";
import { defineSearch, defineSource, staticVectors } from "seekite";
import { glob } from "tinyglobby";

const documentation = defineSource("seekite-docs-markdown", async ({ root }) => {
  const docsDirectory = path.resolve(root, "../../docs");
  const files = await glob("**/*.md", { cwd: docsDirectory, absolute: true });

  return Promise.all(
    files.map(async (file) => {
      const parsed = matter(await readFile(file, "utf8"));
      const relative = path.relative(docsDirectory, file).split(path.sep).join("/");
      const slug = relative.replace(/\.md$/, "").replace(/\/index$/, "");
      const heading = /^#\s+(.+)$/m.exec(parsed.content)?.[1]?.trim();
      const title = typeof parsed.data["title"] === "string" ? parsed.data["title"] : heading;
      const section =
        typeof parsed.data["section"] === "string"
          ? parsed.data["section"]
          : slug.includes("/")
            ? "Integrations"
            : "Guides";
      return {
        id: relative,
        url: `/docs/${slug}`,
        title: title ?? slug,
        content: `<main>${await marked.parse(parsed.content)}</main>`,
        metadata: {
          ...parsed.data,
          section,
          seekiteFormat: "html",
          sourcePath: `docs/${relative}`,
        },
      };
    }),
  );
});

export default defineSearch({
  format: 2,
  corpora: {
    docs: {
      source: documentation,
      vectors: staticVectors(seekiteEmbeddings()),
      filters: ["section"],
      facets: ["section"],
      lang: "en",
      chunk: { maxWords: 170, overlapWords: 24 },
    },
  },
});
