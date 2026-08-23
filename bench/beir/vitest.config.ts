import path from "node:path";
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@seekite/build": path.resolve(import.meta.dirname, "../../packages/build/src/index.ts"),
      "@seekite/core": path.resolve(import.meta.dirname, "../../packages/core/src/index.ts"),
      "@seekite/embeddings-ternlight": path.resolve(
        import.meta.dirname,
        "../../packages/embeddings-ternlight/src/index.node.ts",
      ),
    },
  },
});
