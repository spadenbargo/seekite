import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

import { createNativeEngine, isSupported, nativeBindingError } from "./index.js";

const require = createRequire(import.meta.url);

interface RawBinding {
  Engine: new (bytes: Buffer) => {
    embed(text: string): Float32Array;
    tokenize(text: string): number[];
  };
}

function rawBinding(): RawBinding {
  return require("../binding.cjs") as RawBinding;
}

function miniBytes(): Buffer {
  return readFileSync(fileURLToPath(new URL("../models/mini-int4.bin", import.meta.url)));
}

describe.runIf(isSupported())("engine", () => {
  it("loads without a binding error", () => {
    expect(nativeBindingError()).toBeUndefined();
  });

  it("exposes the model's output width", () => {
    expect(createNativeEngine().dimensions).toBe(384);
    expect(createNativeEngine({ model: "base" }).dimensions).toBe(384);
  });

  it("reuses one engine per model rather than reparsing weights", () => {
    expect(createNativeEngine({ model: "mini" })).toBe(createNativeEngine());
    expect(createNativeEngine({ model: "base" })).not.toBe(createNativeEngine({ model: "mini" }));
  });

  it("is deterministic across repeated calls", () => {
    const engine = createNativeEngine();
    const first = engine.embed("determinism is the whole point");
    const second = engine.embed("determinism is the whole point");
    expect(Buffer.from(first.buffer, first.byteOffset, first.byteLength)).toEqual(
      Buffer.from(second.buffer, second.byteOffset, second.byteLength),
    );
  });

  it("truncates at max_seq_len instead of failing", () => {
    const engine = createNativeEngine();
    const long = "word ".repeat(5_000);
    expect(engine.embed(long)).toHaveLength(384);
  });

  it("returns an empty batch for an empty input list", async () => {
    await expect(createNativeEngine().embedBatch([])).resolves.toEqual([]);
  });

  // Malformed weights must surface as a JS exception. A Rust `panic!` here
  // would unwind through the addon boundary and take the whole process with it,
  // which is a much worse failure mode for a build tool than a thrown error.
  describe("rejects malformed model bytes", () => {
    const cases: Array<[string, () => Buffer]> = [
      ["empty buffer", () => Buffer.alloc(0)],
      ["wrong magic", () => Buffer.alloc(4096, 0x41)],
      ["truncated body", () => miniBytes().subarray(0, 100_000)],
      [
        "corrupted payload (sha256 trailer no longer matches)",
        () => {
          const bytes = miniBytes();
          bytes[50_000] = (bytes[50_000] as number) ^ 0xff;
          return bytes;
        },
      ],
    ];

    for (const [name, makeBytes] of cases) {
      it(name, () => {
        expect(() => new (rawBinding().Engine)(makeBytes())).toThrow(/invalid Seekite model/);
      });
    }
  });

  it("tokenizes with BERT special tokens and pads to max_seq_len", () => {
    const ids = new (rawBinding().Engine)(miniBytes()).tokenize("hello world");
    expect(ids).toHaveLength(128);
    expect(ids[0]).toBe(101); // [CLS]
    expect(ids[3]).toBe(102); // [SEP] after two word pieces
    expect(ids.slice(4).every((id) => id === 0)).toBe(true); // [PAD]
  });
});
