import { defineConfig } from "vite-plus";

export default defineConfig({
  // `vp pack` reads this block (rather than package-local tsdown configs) in
  // Vite+ 0.2.x. Package tsdown configs remain the plain-tool fallback.
  pack: {
    dts: true,
    sourcemap: true,
    clean: true,
    deps: { neverBundle: [/(^|[/\\])wasm[/\\]/] },
    publint: true,
    attw: { profile: "esm-only", level: "error" },
  },
  fmt: {
    // Prose and vendored/generated code are excluded: docs/READMEs are hand-authored
    // markdown owned by other agents, and wasm/native output is generated (wasm-bindgen
    // glue, Cargo.toml, tokenizer.json) rather than authored TS/JS.
    ignorePatterns: ["**/*.md", "docs/**", "**/wasm/**", "**/native/**", "**/routeTree.gen.ts"],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    ignorePatterns: ["**/wasm/**", "**/native/**", "**/routeTree.gen.ts"],
    // correctness stays a hard error; suspicious/perf are downgraded to warn because
    // the existing codebase (predating this lint gate) trips several suspicious-category
    // and type-aware rules that are stylistic rather than actual bugs. See individual
    // rule overrides below for the specific noisy rules kept at "warn".
    categories: {
      correctness: "error",
      suspicious: "warn",
      perf: "warn",
    },
    rules: {
      // Existing test files intentionally still import from "vitest" rather than
      // "vite-plus/test" (rewriting them is out of this change's scope - it would
      // touch src files owned by other in-flight work). `vp test run` works fine
      // either way, so this is a hygiene warning, not a hard gate.
      "vite-plus/prefer-vite-plus-imports": "warn",
      // Type-aware rules that fire on pre-existing patterns in code this change
      // doesn't own; downgraded to warn rather than silently disabled.
      "typescript/no-base-to-string": "warn",
      "typescript/no-floating-promises": "warn",
      "typescript/no-unsafe-type-assertion": "warn",
      "typescript/no-redundant-type-constituents": "warn",
    },
    // typeCheck is off: with it on, oxlint-tsgolint reports raw compiler diagnostics
    // (missing JSX config in examples, missing vite/client CSS-module types, etc.)
    // for gaps that predate this change and live outside this change's owned files.
    // typeAware stays on so the curated type-aware lint rules above still run.
    options: { typeAware: true, typeCheck: false },
  },
  run: {
    tasks: {
      "native:check": {
        command: [
          "cargo fmt --manifest-path packages/embeddings-ternlight/native/Cargo.toml -- --check",
          "cargo fmt --manifest-path packages/engine-native/crates/seekite-engine-napi/Cargo.toml -- --check",
          "cargo clippy --manifest-path packages/embeddings-ternlight/native/Cargo.toml --no-default-features --features emb_int4 --all-targets -- -D warnings",
          "cargo clippy --manifest-path packages/engine-native/crates/seekite-engine-napi/Cargo.toml --all-targets -- -D warnings",
        ],
        input: [
          "packages/embeddings-ternlight/native/src/**",
          "packages/embeddings-ternlight/native/assets/tokenizer.json",
          "packages/embeddings-ternlight/native/Cargo.*",
          "packages/engine-native/crates/seekite-engine-napi/src/**",
          "packages/engine-native/crates/seekite-engine-napi/Cargo.*",
          "packages/engine-native/crates/seekite-engine-napi/build.rs",
        ],
        output: [],
      },
      "native:build": {
        command: "pnpm --filter @seekite/engine-native build:native",
        input: [
          "packages/embeddings-ternlight/native/src/**",
          "packages/embeddings-ternlight/native/assets/tokenizer.json",
          "packages/embeddings-ternlight/native/Cargo.*",
          "packages/engine-native/crates/**",
          "packages/engine-native/models/**",
          "packages/engine-native/binding.cjs",
          "packages/engine-native/package.json",
        ],
        output: ["packages/engine-native/*.node"],
      },
      "wasm:build": {
        command: "pnpm --filter @seekite/embeddings-ternlight build:wasm",
        env: ["SEEKITE_MINI_MODEL", "SEEKITE_BASE_MODEL"],
        input: [
          "packages/embeddings-ternlight/native/src/**",
          "packages/embeddings-ternlight/native/assets/tokenizer.json",
          "packages/embeddings-ternlight/native/Cargo.*",
          "packages/embeddings-ternlight/scripts/build-wasm.sh",
        ],
        output: ["packages/embeddings-ternlight/wasm/**"],
      },
      docs: {
        command: "pnpm --filter @seekite/docs build",
        dependsOn: [
          "@seekite/core#build",
          "@seekite/build#build",
          "seekite#build",
          "@seekite/vite#build",
          "@seekite/embeddings-ternlight#build",
          "@seekite/search-ui#build",
          "@seekite/react#build",
          "@seekite/lab#build",
        ],
        input: [
          { pattern: "apps/docs/**", base: "workspace" },
          { pattern: "docs/**", base: "workspace" },
        ],
        output: [{ pattern: "apps/docs/dist/**", base: "workspace" }],
      },
      pipeline: {
        command: ["vp check", "vp test run", "pnpm build", "vp run native:check"],
        cache: false,
      },
    },
  },
});
