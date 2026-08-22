import { seekiteEmbeddings } from "@seekite/embeddings-ternlight";
import { defineSearch, runtimeVectors } from "seekite";

export default defineSearch({
  corpora: {
    guides: {
      source: [
        {
          id: "auth",
          url: "/guides/auth",
          title: "Authentication",
          content: "# Authentication\nUse short-lived sessions and rotate credentials safely.",
        },
        {
          id: "canvas",
          url: "/guides/canvas",
          title: "Canvas",
          content: "# Canvas drawing\nRender lines, paths, and shapes in a local browser canvas.",
        },
      ],
      vectors: runtimeVectors(seekiteEmbeddings()),
    },
  },
});
