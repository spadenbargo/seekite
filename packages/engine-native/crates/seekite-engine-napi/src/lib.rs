//! napi-rs bindings for Seekite's ternlight embedding engine.
//!
//! This crate is deliberately thin: all inference lives in
//! `seekite-embedding-engine` (`packages/embeddings-ternlight/native`), the same
//! crate the wasm artifacts are built from. Native and wasm therefore run the
//! *same* Rust source over the *same* packed weights, which is what makes the
//! released contract — "`seekite:ternlight:mini:v1` means one exact vector,
//! whichever backend produced it" — hold rather than merely be hoped for.
//!
//! Two deliberate differences from the wasm build:
//!
//! - **No embedded weights.** The engine crate is depended on with
//!   `default-features = false`, which drops its `embedded_model` feature and
//!   with it the `include_bytes!` of `assets/model.bin`. Weights are passed to
//!   [`Engine::new`] as bytes. `@seekite/engine-native` ships them once as a
//!   package asset instead of duplicating megabytes into every platform binary.
//! - **Instance-scoped models.** The wasm surface has a single process-global
//!   model (it has nowhere to hang a handle); here each `Engine` owns its
//!   `LoadedModel`, so `mini` and `base` can be live at the same time.

use std::sync::Arc;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use rayon::prelude::*;

use tern_engine::inference;
use tern_engine::model::{self, LoadedModel};

// ─────────────────────────────────────────────────────────────────────────────
// Engine
// ─────────────────────────────────────────────────────────────────────────────

/// A loaded embedding model.
///
/// Construction parses and verifies the packed `.bin` (sha256 trailer, header,
/// full layout walk) and pre-decodes the hot weight sections, so it costs
/// ~100 ms and a few MB; hold onto the instance rather than rebuilding it.
/// Once built it is immutable, which is why `embed` takes `&self` and why
/// batching can fan out across threads.
#[napi]
pub struct Engine {
    model: Arc<LoadedModel>,
}

#[napi]
impl Engine {
    /// Build an engine from packed model bytes (the contents of a
    /// `models/<name>-int4.bin` asset).
    ///
    /// Errors — rather than panics — on any malformed input: bad magic, wrong
    /// wire-format version, an embedding format this build was not compiled for,
    /// a failed sha256, or a body length that disagrees with the header's layout.
    #[napi(constructor)]
    pub fn new(model_bytes: Buffer) -> Result<Self> {
        let model = LoadedModel::from_bytes(model_bytes.to_vec())
            .map_err(|e| Error::new(Status::InvalidArg, format!("invalid Seekite model: {e}")))?;
        Ok(Engine {
            model: Arc::new(model),
        })
    }

    /// Output vector width (384 for both shipped models).
    #[napi]
    pub fn dimensions(&self) -> u32 {
        self.model.layout.header.output_dim as u32
    }

    /// Maximum token count; longer inputs are truncated by the tokenizer.
    #[napi]
    pub fn max_seq_len(&self) -> u32 {
        self.model.layout.header.max_seq_len as u32
    }

    /// Human-readable header summary. Matches the wasm build's `config_summary()`
    /// byte for byte, which makes it a quick "am I running the same weights?"
    /// check when parity tests disagree.
    #[napi]
    pub fn config_summary(&self) -> String {
        model::describe(&self.model)
    }

    /// Token ids for `text`, padded to `max_seq_len`. Diagnostic only — parity
    /// failures are almost always tokenizer drift, and this localises them.
    #[napi]
    pub fn tokenize(&self, text: String) -> Vec<u32> {
        tern_engine::tokenizer::tokenize(&text)
    }

    /// Embed one text into an L2-normalised vector.
    ///
    /// Synchronous on purpose: a single short text is ~1 ms, well under the
    /// threshold where handing work to the thread pool pays for itself. Use
    /// [`Engine::embed_batch`] for anything corpus-sized.
    #[napi]
    pub fn embed(&self, text: String) -> Float32Array {
        Float32Array::new(inference::embed_with(&self.model, &text))
    }

    /// Embed many texts on a worker thread pool, resolving to one
    /// `Float32Array` per input in input order.
    ///
    /// Parallelism is **across** texts only, never within a text: each forward
    /// pass is an independent, side-effect-free function of `(model, text)`, so
    /// every element is bit-identical to what a sequential [`Engine::embed`]
    /// would have produced. Thread count only changes timing, never output.
    ///
    /// `concurrency` defaults to rayon's global pool (one thread per core). A
    /// smaller value is useful when the caller is already parallel — `seekite
    /// build` embedding several corpora at once, say — and wants to cap total
    /// CPU. Passing a value builds a dedicated pool for the call, so prefer
    /// large batches over many small ones when you set it.
    #[napi(ts_return_type = "Promise<Float32Array[]>")]
    pub fn embed_batch(
        &self,
        texts: Vec<String>,
        concurrency: Option<u32>,
    ) -> AsyncTask<EmbedBatch> {
        AsyncTask::new(EmbedBatch {
            model: Arc::clone(&self.model),
            texts,
            concurrency,
        })
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch task
// ─────────────────────────────────────────────────────────────────────────────

/// The off-thread half of [`Engine::embed_batch`].
///
/// `compute` runs on libuv's thread pool (so the JS event loop keeps turning),
/// and fans out from there onto rayon.
pub struct EmbedBatch {
    model: Arc<LoadedModel>,
    texts: Vec<String>,
    concurrency: Option<u32>,
}

impl Task for EmbedBatch {
    type Output = Vec<Vec<f32>>;
    type JsValue = Vec<Float32Array>;

    fn compute(&mut self) -> Result<Self::Output> {
        let model = &self.model;
        let texts = &self.texts;
        // `par_iter().map(..).collect()` is order-preserving, so the result index
        // matches the input index regardless of completion order.
        let run = || -> Vec<Vec<f32>> {
            texts
                .par_iter()
                .map(|text| inference::embed_with(model, text))
                .collect()
        };

        match self.concurrency {
            Some(n) if n > 0 => {
                let pool = rayon::ThreadPoolBuilder::new()
                    .num_threads(n as usize)
                    .build()
                    .map_err(|e| Error::new(Status::GenericFailure, format!("thread pool: {e}")))?;
                Ok(pool.install(run))
            }
            _ => Ok(run()),
        }
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into_iter().map(Float32Array::new).collect())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hashing
// ─────────────────────────────────────────────────────────────────────────────

/// XXH64 of `input`, returned as a BigInt (the full unsigned 64-bit value —
/// a JS `number` would silently lose the low bits).
///
/// Exposed here rather than in JS because spec 06 hashes every source file on
/// every build; doing it in the addon keeps the cache-key cost off the main
/// thread's critical path and avoids a second hashing implementation.
#[napi]
pub fn xxhash64(input: Buffer, seed: Option<BigInt>) -> BigInt {
    let seed = seed.map(|s| s.get_u64().1).unwrap_or(0);
    BigInt::from(xxhash_rust::xxh64::xxh64(&input, seed))
}
