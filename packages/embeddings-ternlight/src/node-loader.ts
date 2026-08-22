import type { NativeEngine, NativeEngineOptions } from "@seekite/engine-native";
import type { EmbeddingEngine } from "./shared.js";

export interface NativeEngineModule {
  isSupported(): boolean;
  createNativeEngine(options?: NativeEngineOptions): NativeEngine;
}

interface NodeEngineLoaders {
  model: "mini" | "base";
  loadNative(): Promise<NativeEngineModule>;
  loadWasm(): EmbeddingEngine | Promise<EmbeddingEngine>;
}

export function requireEmbeddingEngine(value: unknown): EmbeddingEngine {
  if (
    typeof value !== "object" ||
    value === null ||
    !("embed" in value) ||
    typeof value.embed !== "function" ||
    ("embedBatch" in value &&
      value.embedBatch !== undefined &&
      typeof value.embedBatch !== "function")
  ) {
    throw new TypeError("Seekite's Wasm module does not expose a compatible embedding engine");
  }

  const embed = value.embed;
  const embedBatch =
    "embedBatch" in value && typeof value.embedBatch === "function" ? value.embedBatch : undefined;
  return {
    embed(input) {
      const result: unknown = Reflect.apply(embed, value, [input]);
      if (!(result instanceof Float32Array)) {
        throw new TypeError("Seekite's Wasm embed() returned an invalid vector");
      }
      return result;
    },
    ...(embedBatch
      ? {
          async embedBatch(inputs: string[]) {
            const result: unknown = await Reflect.apply(embedBatch, value, [inputs]);
            if (!Array.isArray(result)) {
              throw new TypeError("Seekite's Wasm embedBatch() returned an invalid batch");
            }
            return result.map((item: unknown) => {
              if (!(item instanceof Float32Array)) {
                throw new TypeError("Seekite's Wasm embedBatch() returned an invalid vector");
              }
              return item;
            });
          },
        }
      : {}),
  };
}

/**
 * Prefer the Node addon when its optional peer and a matching prebuild are
 * available. Import, binding, and model-load failures all fall back to the
 * committed Wasm engine so unsupported hosts never compile during install.
 */
export async function loadNodeEngine(loaders: NodeEngineLoaders): Promise<EmbeddingEngine> {
  try {
    const native = await loaders.loadNative();
    if (native.isSupported()) {
      return native.createNativeEngine({ model: loaders.model });
    }
  } catch {
    // The addon is an optional acceleration path. Wasm is the portable backend.
  }

  return loaders.loadWasm();
}
