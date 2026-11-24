import { defineSearch } from "seekite";

export default defineSearch({
  corpora: {
    docs: {
      facets: ["section"],
      source: [
        {
          id: "install",
          metadata: { section: "Guide" },
          url: "/docs/install",
          title: "Install",
          content: "# Installation\nInstall packages with pnpm, npm, or yarn.",
        },
        {
          id: "config",
          metadata: { section: "Guide" },
          url: "/docs/config",
          title: "Configuration",
          content: "# Corpora\nConfigure independently loadable search corpora.",
        },
      ],
    },
    tools: {
      filters: ["platform"],
      source: [
        {
          id: "cli",
          metadata: { platform: "node" },
          url: "/tools/cli",
          title: "CLI",
          content: "# Build command\nThe command line interface creates static indexes.",
        },
        {
          id: "vite",
          metadata: { platform: "node" },
          url: "/tools/vite",
          title: "Vite",
          content: "# Vite plugin\nThe thin integration indexes generated HTML.",
        },
      ],
    },
  },
});
