import { seekite } from "@seekite/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  base: "/docs/",
  // CI runs `seekite build` first; Vite copies public/search into the bundle.
  plugins: [seekite({ indexing: "external" })],
});
