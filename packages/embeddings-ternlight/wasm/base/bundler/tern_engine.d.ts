/* tslint:disable */
/* eslint-disable */

/**
 * Debug helper: returns a human-readable summary of the loaded model's
 * header (format version, embedding format, dimensions, vocab size).
 */
export function config_summary(): string;

/**
 * Primary entry point: text → 384-dim L2-normalized embedding.
 *
 * Tokenizes via the embedded BERT vocab, runs the full forward pass against
 * the embedded `.bin`, returns the output vector.
 */
export function embed(text: string): Float32Array;

/**
 * Debug helper: returns token IDs the tokenizer produced. Used by per-stage
 * parity tests to confirm tokenization matches the Python `tokenizers` library.
 */
export function tokenize(text: string): Uint32Array;
