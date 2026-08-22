import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  dts: true,
  sourcemap: true,
  clean: true,
  platform: "neutral",
  publint: true,
  // esm-only: this package ships no CJS entry point, so node10 (CJS-era) resolution
  // and "require() resolves to ESM" findings are expected and ignored.
  attw: { profile: "esm-only", level: "error" },
});
