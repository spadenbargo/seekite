import path from "node:path";
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts"],
  },
  // Tests import workspace packages by name (e.g. "@seekite/core"), which normally
  // resolves through each package's published `exports` map (./dist/...). Aliasing
  // straight to source here means `pnpm test` / `vp test run` pass even when `dist/`
  // hasn't been built yet, instead of silently depending on build order.
  resolve: {
    alias: {
      "@seekite/core": path.resolve(import.meta.dirname, "packages/core/src/index.ts"),
      "@seekite/build": path.resolve(import.meta.dirname, "packages/build/src/index.ts"),
      "@seekite/engine-native": path.resolve(
        import.meta.dirname,
        "packages/engine-native/src/index.ts",
      ),
      "@seekite/lab": path.resolve(import.meta.dirname, "packages/lab/src/index.ts"),
      "@seekite/react": path.resolve(import.meta.dirname, "packages/react/src/index.ts"),
      "@seekite/search-ui": path.resolve(import.meta.dirname, "packages/search-ui/src/index.ts"),
      "@seekite/vite": path.resolve(import.meta.dirname, "packages/vite/src/index.ts"),
    },
  },
});
