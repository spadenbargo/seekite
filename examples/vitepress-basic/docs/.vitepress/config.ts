import { defineConfig } from "vitepress";
import { withSeekite } from "@seekite/vitepress";

export default defineConfig(
  withSeekite({
    title: "Seekite VitePress fixture",
  }),
);
