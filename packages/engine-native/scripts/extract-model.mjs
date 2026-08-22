#!/usr/bin/env node
/**
 * Extract the packed `.bin` model weights out of a committed wasm artifact.
 *
 * Why this exists
 * ---------------
 * `packages/embeddings-ternlight/native/assets/model.bin` is gitignored: the
 * weights only ever lived inside the two committed `tern_engine_bg.wasm` blobs
 * (the wasm build bakes them in with `include_bytes!`). `@seekite/engine-native`
 * needs them as plain files — the native addon deliberately does NOT embed the
 * model, so a single copy is shared by every platform package.
 *
 * Naive extraction from the `.wasm` file bytes does not work: wasm-pack emits
 * the weights across several fragmented data segments, so there is no single
 * contiguous run of file bytes to carve out. What *is* contiguous is the image
 * after instantiation, so:
 *
 *   1. Instantiate the wasm and call `embed()` once. That forces the engine's
 *      lazy model init, guaranteeing the data segments are materialised.
 *   2. Scan linear memory for the wire format's `TERN` magic followed by a
 *      plausible header (`format_version == 1`, `vocab_size == 30522`, ...).
 *   3. Find the end of the buffer using the format's own integrity check: the
 *      last 32 bytes are the SHA256 of everything before them. Walk forward
 *      hashing incrementally and stop at the first offset where the following
 *      32 bytes equal the running digest. That is an exact, self-validating
 *      terminator — no length guessing.
 *   4. Cross-check the parsed header against the extracted size using the same
 *      layout walk as `model.rs::compute_layout`, then write the file.
 *
 * Usage:
 *   node scripts/extract-model.mjs             # both models -> ./models
 *   node scripts/extract-model.mjs mini        # one model
 *   node scripts/extract-model.mjs --out DIR
 *
 * Output: `models/<name>-<format>.bin`, byte-identical to what the wasm build
 * consumed, verified by SHA256 and by the layout walk.
 */

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, "..");
const WASM_ROOT = path.resolve(PKG, "../embeddings-ternlight/wasm");

const EMB_FORMATS = ["fp32", "int8", "ternary", "int4"];
const HEADER_SIZE = 32;
const SHA256_SIZE = 32;
/** Search stays inside a sane window; the largest pack is ~7.5 MB. */
const MIN_BODY_BYTES = 1_000_000;
const EXPECTED_VOCAB = 30522;

function parseHeader(buf, at) {
  return {
    formatVersion: buf.readUInt16LE(at + 4),
    embeddingFormat: buf[at + 6],
    weightsFormat: buf[at + 7],
    vocabSize: buf.readUInt32LE(at + 8),
    dModel: buf.readUInt16LE(at + 12),
    nLayers: buf[at + 14],
    nHeads: buf[at + 15],
    ffnDim: buf.readUInt16LE(at + 16),
    outputDim: buf.readUInt16LE(at + 18),
    maxSeqLen: buf.readUInt16LE(at + 20),
  };
}

/**
 * Mirror of `model.rs::compute_layout` — returns the exact body length the
 * engine will expect for this header. Used as an independent confirmation that
 * what we carved out is a whole, well-formed model.
 */
function expectedBodyBytes(h) {
  const { dModel, nLayers, ffnDim, outputDim, vocabSize } = h;
  let off = HEADER_SIZE;

  const embeddingBytes = {
    0: vocabSize * dModel * 4,
    1: vocabSize * dModel,
    2: vocabSize * (dModel / 4),
    3: vocabSize * (dModel / 2),
  }[h.embeddingFormat];
  if (embeddingBytes === undefined)
    throw new Error(`unknown embedding_format ${h.embeddingFormat}`);
  off += embeddingBytes;
  if (h.embeddingFormat !== 0) off += vocabSize * 4; // per-row scales

  const lnBytes = dModel * 4 * 2;
  // 2-bit packed ternary weights + one f32 scale + optional f32 bias vector.
  const bitlinear = (inF, outF, bias) => outF * (inF / 4) + 4 + (bias ? outF * 4 : 0);

  for (let i = 0; i < nLayers; i++) {
    off += lnBytes;
    off += bitlinear(dModel, dModel, false) * 3; // Q, K, V — no bias
    off += bitlinear(dModel, dModel, true); // W_out
    off += lnBytes;
    off += bitlinear(dModel, ffnDim, true); // fc1
    off += bitlinear(ffnDim, dModel, true); // fc2
  }
  off += lnBytes; // final LN
  off += dModel * outputDim * 4 + outputDim * 4; // fp32 projection + bias
  return off;
}

/** Load the node-target wasm loader with an extra hook exposing linear memory. */
function instantiate(model) {
  const dir = path.join(WASM_ROOT, model, "node");
  const loader = path.join(dir, "tern_engine.js");
  if (!fs.existsSync(loader)) throw new Error(`no wasm artifact for "${model}" at ${loader}`);

  const probe = path.join(dir, `__extract-probe-${process.pid}.cjs`);
  fs.writeFileSync(
    probe,
    `${fs.readFileSync(loader, "utf8")}\nmodule.exports.__memory = wasm.memory;\n`,
  );
  try {
    const require = createRequire(import.meta.url);
    const mod = require(probe);
    mod.embed("force the engine's lazy model init to run");
    return { memory: Buffer.from(mod.__memory.buffer), summary: mod.config_summary() };
  } finally {
    fs.rmSync(probe, { force: true });
  }
}

/** Every offset in `mem` that starts a plausible packed-model header. */
function findCandidates(mem) {
  const hits = [];
  for (let i = 0; i + HEADER_SIZE < mem.length; i++) {
    if (mem[i] !== 0x54 || mem[i + 1] !== 0x45 || mem[i + 2] !== 0x52 || mem[i + 3] !== 0x4e)
      continue;
    const h = parseHeader(mem, i);
    if (h.formatVersion !== 1) continue;
    if (h.vocabSize !== EXPECTED_VOCAB) continue;
    if (h.embeddingFormat > 3 || h.dModel === 0 || h.dModel > 4096) continue;
    if (h.nLayers === 0 || h.nLayers > 64) continue;
    hits.push(i);
  }
  return hits;
}

/**
 * Locate the trailing SHA256 by incremental hashing. Returns the total length
 * (body + 32) of the model starting at `start`, or null if no terminator is
 * found before the end of memory.
 */
function findEnd(mem, start) {
  const maxEnd = mem.length - SHA256_SIZE;
  let cursor = start + MIN_BODY_BYTES;
  if (cursor >= maxEnd) return null;
  const hash = createHash("sha256");
  hash.update(mem.subarray(start, cursor));
  for (; cursor < maxEnd; cursor++) {
    const digest = hash.copy().digest();
    // Cheap 3-byte reject first: a full compare at every offset would be ~7 M
    // 32-byte memcmps. This keeps the scan at a couple of seconds.
    if (
      digest[0] === mem[cursor] &&
      digest[1] === mem[cursor + 1] &&
      digest[2] === mem[cursor + 2]
    ) {
      if (digest.equals(mem.subarray(cursor, cursor + SHA256_SIZE))) {
        return { body: cursor - start, total: cursor - start + SHA256_SIZE };
      }
    }
    hash.update(mem.subarray(cursor, cursor + 1));
  }
  return null;
}

function extract(model, outDir) {
  const { memory, summary } = instantiate(model);
  process.stdout.write(`${model}: ${summary}\n`);
  process.stdout.write(`${model}: linear memory ${memory.length} bytes\n`);

  const candidates = findCandidates(memory);
  if (candidates.length === 0) throw new Error(`${model}: no TERN header found in linear memory`);

  for (const start of candidates) {
    const end = findEnd(memory, start);
    if (!end) continue;
    const header = parseHeader(memory, start);
    const wanted = expectedBodyBytes(header);
    if (wanted !== end.body) {
      throw new Error(
        `${model}: layout walk expects a ${wanted}-byte body but the sha256 terminator is at ${end.body}`,
      );
    }
    const bytes = memory.subarray(start, start + end.total);
    const name = `${model}-${EMB_FORMATS[header.embeddingFormat]}.bin`;
    fs.mkdirSync(outDir, { recursive: true });
    const dest = path.join(outDir, name);
    fs.writeFileSync(dest, bytes);
    const sha = createHash("sha256").update(bytes).digest("hex");
    process.stdout.write(
      `${model}: wrote ${dest} (${end.total} bytes, body ${end.body}, sha256 ${sha})\n`,
    );
    return dest;
  }
  throw new Error(`${model}: found ${candidates.length} TERN header(s) but no sha256 terminator`);
}

const argv = process.argv.slice(2);
const outIdx = argv.indexOf("--out");
const outDir = outIdx === -1 ? path.join(PKG, "models") : path.resolve(argv[outIdx + 1]);
const models = argv.filter((a, i) => !a.startsWith("--") && i !== outIdx + 1);
for (const model of models.length > 0 ? models : ["mini", "base"]) extract(model, outDir);
