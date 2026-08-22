import { defineSearch } from "seekite";

export default defineSearch({
  corpora: {
    docs: {
      source: [
        {
          id: "install",
          url: "/docs/install",
          title: "Install",
          content: "# Installation\nInstall packages with pnpm, npm, or yarn.",
        },
        {
          id: "config",
          url: "/docs/config",
          title: "Configuration",
          content: "# Corpora\nConfigure independently loadable search corpora.",
        },
      ],
    },
    tools: {
      source: [
        {
          id: "cli",
          url: "/tools/cli",
          title: "CLI",
          content: "# Build command\nThe command line interface creates static indexes.",
        },
        {
          id: "vite",
          url: "/tools/vite",
          title: "Vite",
          content: "# Vite plugin\nThe thin integration indexes generated HTML.",
        },
      ],
    },
  },
});
