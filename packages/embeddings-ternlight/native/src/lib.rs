//! tern-engine — WASM inference engine for the tern semantic embedding model.
//!
//! Loads a packed `.bin` (produced by [`training/pack/pack.py`](../../training/pack/pack.py)),
//! tokenizes input text via an embedded BERT vocab, runs the BitLinear-faithful
//! forward pass, and returns a 384-dim L2-normalized embedding.
//!
//! Design + wire-format spec: `docs/tern-inference-engine.md`.
//! Math reference: the Python implementation in `training/pack/unpack.py`. The
//! engine's `kernels::bitlinear_forward` must match `unpack.bitlinear_forward`
//! within the per-format tolerance documented in the engine doc.
//!
//! Build (exactly one embedding feature per build):
//!   wasm-pack build --target nodejs --features emb_int4       # current ship (mini + base)
//!   wasm-pack build --target nodejs --features emb_int8       # alt ship
//!   wasm-pack build --target nodejs --features emb_ternary    # alt ship
//!   wasm-pack build --target nodejs --features emb_fp32       # parity reference
//!
//! Model bytes come from one of two places:
//!   - `embedded_model` (default, what the wasm build uses): `assets/model.bin`
//!     is baked in with `include_bytes!` and parsed lazily by [`model::get`].
//!   - runtime bytes (what `@seekite/engine-native` uses): build with
//!     `--no-default-features --features emb_int4` and construct a
//!     [`model::LoadedModel::from_bytes`], then call [`inference::embed_with`].
//!     Nothing is baked in, so `assets/model.bin` need not exist.

// ── Compile-time feature exclusivity ────────────────────────────────────────
// Exactly one of the embedding-format features must be enabled.

#[cfg(not(any(
    feature = "emb_fp32",
    feature = "emb_int8",
    feature = "emb_ternary",
    feature = "emb_int4",
)))]
compile_error!(
    "tern-engine requires exactly one embedding-format feature: \
     emb_fp32, emb_int8, emb_ternary, or emb_int4. \
     Build with e.g. `wasm-pack build --features emb_int8`."
);

#[cfg(any(
    all(feature = "emb_fp32", feature = "emb_int8"),
    all(feature = "emb_fp32", feature = "emb_ternary"),
    all(feature = "emb_fp32", feature = "emb_int4"),
    all(feature = "emb_int8", feature = "emb_ternary"),
    all(feature = "emb_int8", feature = "emb_int4"),
    all(feature = "emb_ternary", feature = "emb_int4"),
))]
compile_error!(
    "tern-engine accepts exactly one embedding-format feature; \
     multiple were enabled. Pick one of: emb_fp32 | emb_int8 | emb_ternary | emb_int4."
);

// WASM SIMD is required on the wasm32 build target — the BitLinear matmul
// uses explicit `simd128` intrinsics (Phase B2). The flag is set in
// engine/.cargo/config.toml; this check catches the case where the config
// is missing or overridden.
#[cfg(all(target_arch = "wasm32", not(target_feature = "simd128")))]
compile_error!(
    "tern-engine requires WASM SIMD (`+simd128`). \
     Ensure engine/.cargo/config.toml sets `target-feature=+simd128`, \
     or pass it via RUSTFLAGS. See docs/tern-runtime-perf.md → Phase B."
);

// ── Modules ─────────────────────────────────────────────────────────────────

pub mod format;
pub mod inference;
pub mod kernels;
pub mod model;
pub mod tokenizer;

// ── Public WASM surface ─────────────────────────────────────────────────────

use wasm_bindgen::prelude::*;

/// Primary entry point: text → 384-dim L2-normalized embedding.
///
/// Tokenizes via the embedded BERT vocab, runs the full forward pass against
/// the embedded `.bin`, returns the output vector.
#[wasm_bindgen]
pub fn embed(text: &str) -> Vec<f32> {
    inference::embed(text)
}

/// Debug helper: returns token IDs the tokenizer produced. Used by per-stage
/// parity tests to confirm tokenization matches the Python `tokenizers` library.
#[wasm_bindgen]
pub fn tokenize(text: &str) -> Vec<u32> {
    tokenizer::tokenize(text)
}

/// Debug helper: returns a human-readable summary of the loaded model's
/// header (format version, embedding format, dimensions, vocab size).
#[wasm_bindgen]
pub fn config_summary() -> String {
    model::config_summary()
}
