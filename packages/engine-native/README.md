# @seekite/engine-native

Native (napi-rs) build of Seekite's ternlight embedding engine.

The inference engine and packed weights are derived from Ternlight v0.1.1
(upstream commit `c6d2c0a35d14c574ed2898b3dbf95977bca07208`) under MIT. The
upstream notice ships in `@seekite/embeddings-ternlight` as
`TERNLIGHT-LICENSE`; model training and artifact provenance are documented in
the public provider guide.

`@seekite/embeddings-ternlight` ships a WebAssembly engine that runs everywhere,
including the browser. In Node — CI builds, `seekite build`, the embedding lab —
that leaves throughput on the table. This package exposes the *same* Rust crate
as a native addon, with prebuilt binaries for mainstream platforms and no
compile step at install time.

```ts
import { createNativeEngine, isSupported } from "@seekite/engine-native"

if (isSupported()) {
  const engine = createNativeEngine()          // "mini" (default) or "base"
  const one = engine.embed("hello world")      // Float32Array(384), L2-normalised
  const many = await engine.embedBatch(chunks) // off-thread, all cores
}
```

`isSupported()` returning `false` is not an error — it means this platform has
no prebuild, and the caller should use the wasm engine instead.

## The parity contract

Both backends are published under one provider id (`seekite:ternlight:mini:v1`),
so an index built by the native addon has to be queryable by the wasm engine in
a browser. That only holds if the two agree **exactly**, and the test suite
asserts byte equality of the output buffers — not approximate equality — over a
fixture set covering multilingual text, emoji and ZWJ sequences, combining
marks, empty-ish inputs, and inputs past the 128-token truncation point.

This works because the two builds are the same Rust source over the same packed
weights. The only divergent code is the BitLinear inner loop (`simd128` on wasm;
AVX2/SSE4.1 on x86_64, NEON on aarch64), and that loop is an exact
`i8 × i8 → i32` multiply-accumulate with a proven bound of `128 × 1024`, so it
cannot overflow and lane ordering cannot change the result.

Batch results carry the same guarantee: `embedBatch` parallelises across texts,
never inside one, so element *i* is bit-identical to `embed(texts[i])` at any
thread count.

## Throughput

1 000 short chunks, mini model, 16-core x86_64 (AVX2), release build:

| | time | vs wasm |
|---|---|---|
| wasm sequential | 5.01 s | 1.0× |
| native sequential | 2.91 s | 1.7× |
| native `embedBatch` (1 thread) | 2.85 s | 1.8× |
| native `embedBatch` (all cores) | 0.32 s | 15.5× |

The single-threaded gain is the SIMD kernel; the rest is parallelism.
Reproduce with `pnpm vitest bench packages/engine-native`.

## Model weights

The native addon carries **no** embedded weights — it is built with the engine
crate's `embedded_model` feature off, and `Engine` takes the packed bytes at
construction. The two `.bin` files therefore ship once per package rather than
once per platform binary.

They are not stored in git twice: the only committed copy lives inside the wasm
artifacts, so `pnpm extract-models` recovers them from there. That script
instantiates the wasm, scans linear memory for the wire format's `TERN` magic,
finds the end via the format's trailing SHA256 self-check, and cross-checks the
result against the layout walk in the engine crate before writing anything.

```sh
pnpm extract-models   # -> models/mini-int4.bin, models/base-int4.bin
```

## Building locally

```sh
pnpm extract-models   # once — the build needs models/ to run the tests
pnpm build            # napi build --release + tsc
pnpm build:debug      # faster compile, ~3× slower embeddings
```

Prebuilds are produced by `.github/workflows/native.yml` for
`linux-x64-gnu`, `linux-arm64-gnu`, `linux-x64-musl`, `darwin-x64`,
`darwin-arm64` and `win32-x64-msvc`. Anything else falls back to wasm — there is
no compile-on-install path, because install has to stay deterministic.

## Escape hatch

`SEEKITE_DISABLE_NATIVE=1` forces `isSupported()` to `false` even when a
prebuild is present, so the wasm path can be reproduced without uninstalling
anything. CI uses it to prove the fallback still works.

## API

```ts
function isSupported(): boolean
function nativeBindingError(): Error | undefined
function createNativeEngine(options?: { model?: "mini" | "base" }): {
  readonly dimensions: number
  embed(text: string): Float32Array
  embedBatch(texts: string[], concurrency?: number): Promise<Float32Array[]>
  configSummary(): string
}
function xxhash64(input: string | Uint8Array, seed?: bigint): bigint
```

`xxhash64` is here because spec 06's incremental-build cache keys every source
file on every build; doing it in the addon keeps that off the critical path and
avoids a second hashing implementation. It returns a `bigint` — the top bits of
a 64-bit hash do not survive a JS `number`.
