# Native embedding engine

This directory is Seekite's maintained Rust/Wasm inference engine. It was
derived from Ternlight v0.1.1 at commit
`c6d2c0a35d14c574ed2898b3dbf95977bca07208` under the MIT license; the original
license is in `../TERNLIGHT-LICENSE`.

The checked-in `wasm/` artifacts make normal npm installs deterministic. They
are generated from this source, not downloaded from an npm dependency.
`../wasm/manifest.json` pins the source revision and artifact hashes.

## Two consumers, one crate

The crate is compiled twice, from the same source, for two very different hosts.
Both must produce **bit-identical** vectors — `@seekite/embeddings-ternlight`
publishes one provider id per model regardless of backend, so an index built in
CI has to be queryable in a browser.

| | wasm (`wasm-pack`) | native (`@seekite/engine-native`) |
|---|---|---|
| Cargo features | default (`embedded_model`) + `emb_int4` | `--no-default-features --features emb_int4` |
| Model bytes | `include_bytes!("assets/model.bin")` | passed to `model::LoadedModel::from_bytes` at runtime |
| Entry point | `model::get()` / `inference::embed` | `inference::embed_with(&model, text)` |
| BitLinear inner loop | `simd128` intrinsics | AVX2 → SSE4.1 → scalar (x86_64), NEON (aarch64) |

The SIMD paths differ but the arithmetic does not: the inner loop is an exact
`i8 × i8 → i32` multiply-accumulate bounded by `128 × 1024`, so it cannot
overflow, and integer addition is associative — every lane arrangement produces
the same integer. Everything else is IEEE-754 `f32` in the same evaluation
order, with `libm` supplying `expf`/`erff` in software on both targets. The
parity test in `packages/engine-native/src/parity.test.ts` enforces this over a
multilingual/emoji/long-input fixture set.

### Model loading

`embedded_model` is a default feature, so the wasm build and its script are
unchanged. Turning it off drops the `include_bytes!` entirely, which is what
lets the native addon build without `assets/model.bin` existing and ship the
weights once as a package asset instead of once per platform binary.

`LoadedModel` stores its bytes in a `Cow<'static, [u8]>`: borrowed for the
embedded blob (zero copy), owned for runtime bytes. Nothing is leaked, so a
host can hold several models at once — `@seekite/engine-native` keeps `mini`
and `base` live simultaneously.

## Rebuilding the wasm artifacts

To rebuild, provide the two packed model files and run:

```sh
SEEKITE_MINI_MODEL=/absolute/path/model-mini-int4.bin \
SEEKITE_BASE_MODEL=/absolute/path/model-base-int4.bin \
pnpm build:wasm
```

The script requires `wasm-pack` and validates that both inputs exist before it
changes generated output.

If you no longer have the packed models to hand, they can be recovered from the
committed wasm artifacts — see
`packages/engine-native/scripts/extract-model.mjs`, which writes
`packages/engine-native/models/{mini,base}-int4.bin` and verifies each against
the wire format's own SHA256 trailer and the layout walk in `src/model.rs`.
