import { createRequire } from "node:module";
import { bench, describe } from "vite-plus/test";

import { createNativeEngine, isSupported } from "./index.js";

/**
 * Throughput: native vs wasm, sequential vs batched.
 *
 * Run with `vitest bench packages/engine-native`. The numbers feed the
 * embedding lab's baseline file (spec 03) so regressions in either backend
 * surface as a diff rather than as a vague "builds feel slower".
 *
 * The corpus is 1 000 short chunks, which is what `seekite build` actually does
 * — a page of docs is a few hundred chunks — rather than one long document.
 */

const require = createRequire(import.meta.url);

interface WasmEngine {
  embed(text: string): Float32Array;
}

const wasm = require("../../embeddings-ternlight/wasm/mini/node/tern_engine.js") as WasmEngine;

const CHUNKS = Array.from(
  { length: 1_000 },
  (_, i) =>
    `Section ${i}: Seekite builds a static search index at build time, so queries run in the browser with no server round trip.`,
);

// Each sample already embeds 1,000 texts. Tinybench's default 5 warmups + 10
// measured iterations turns that product-sized workload into a multi-minute
// command, so sample the complete corpus once per implementation.
const OPTIONS = { time: 0, iterations: 1, warmupTime: 0, warmupIterations: 0 };

describe("embed 1000 short chunks", () => {
  bench(
    "wasm sequential",
    () => {
      for (const chunk of CHUNKS) wasm.embed(chunk);
    },
    OPTIONS,
  );

  bench.skipIf(!isSupported())(
    "native sequential",
    () => {
      const engine = createNativeEngine();
      for (const chunk of CHUNKS) engine.embed(chunk);
    },
    OPTIONS,
  );

  bench.skipIf(!isSupported())(
    "native batch (all cores)",
    async () => {
      await createNativeEngine().embedBatch(CHUNKS);
    },
    OPTIONS,
  );

  bench.skipIf(!isSupported())(
    "native batch (1 thread)",
    async () => {
      await createNativeEngine().embedBatch(CHUNKS, 1);
    },
    OPTIONS,
  );
});
