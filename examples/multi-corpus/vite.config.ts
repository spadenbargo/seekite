import { seekite } from "@seekite/vite";
import { defineConfig } from "vite-plus";

export default defineConfig(({ command }) => ({
  plugins: [seekite({ indexing: command === "build" ? "external" : "vite" })],
}));
