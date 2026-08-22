import { defineConfig } from "tsdown";

// NOTE: `vp pack` (unlike plain `tsdown`) does not read multi-entry `entry` maps
// from this config file when invoked with no CLI file arguments - it silently
// falls back to `src/index.ts` only. The package.json "build" script therefore
// passes both entries explicitly: `vp pack src/index.ts src/cli.ts --dts`.
// This config's `entry` is kept for the plain-`tsdown` fallback path, which does
// read it correctly.
export default defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli.ts" },
  format: "esm",
  dts: true,
  sourcemap: true,
  clean: true,
  platform: "node",
  publint: true,
  attw: { profile: "esm-only", level: "error" },
});
