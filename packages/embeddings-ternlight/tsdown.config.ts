import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    "index.browser": "src/index.browser.ts",
    "index.node": "src/index.node.ts",
    "base.browser": "src/base.browser.ts",
    "base.node": "src/base.node.ts",
  },
  format: "esm",
  dts: true,
  sourcemap: true,
  clean: true,
  platform: "node",
  deps: {
    neverBundle: ["@seekite/core", "@seekite/engine-native", /^node:/, /(^|[/\\])wasm[/\\]/],
  },
  publint: true,
  attw: { profile: "esm-only", level: "error" },
});
