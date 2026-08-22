import { seekiteEmbeddings } from "@seekite/embeddings-ternlight";
import { defineSearch, defineSource, staticVectors } from "seekite";

const contentApi = defineSource("content-api", async () => [
  {
    id: "home",
    url: "/",
    title: "Seekite",
    content: "# Local search\nStatic vectors are generated once and served with the application.",
  },
  {
    id: "vectors",
    url: "/vectors",
    title: "Vector modes",
    content: "# Vector modes\nChoose CI-generated static vectors or lazy runtime vectors.",
  },
]);

export default defineSearch({
  output: "public/search",
  corpora: {
    docs: {
      source: contentApi,
      include: ["/**"],
      vectors: staticVectors(seekiteEmbeddings()),
    },
  },
});
