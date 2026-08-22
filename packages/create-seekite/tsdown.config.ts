import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  dts: true,
  format: "esm",
  platform: "node",
  target: "node20",
  clean: true,
});
