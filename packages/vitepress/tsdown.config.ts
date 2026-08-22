import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/theme.ts"],
  format: "esm",
  dts: true,
  sourcemap: true,
  clean: true,
  platform: "node",
  publint: true,
  attw: { profile: "esm-only", level: "error" },
});
