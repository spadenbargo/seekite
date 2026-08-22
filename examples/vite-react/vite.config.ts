import react from "@vitejs/plugin-react";
import { seekite } from "@seekite/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  worker: { format: "es" },
  plugins: [react(), seekite()],
});
