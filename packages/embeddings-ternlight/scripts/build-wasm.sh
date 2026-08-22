#!/usr/bin/env bash

set -euo pipefail

package_dir="$(cd "$(dirname "$0")/.." && pwd)"
native_dir="$package_dir/native"

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "wasm-pack is required to rebuild Seekite's embedding engine" >&2
  exit 1
fi

build_model() {
  local model="$1"
  local model_bin="$2"
  local output_dir="$package_dir/wasm/$model"

  if [[ -z "$model_bin" || ! -f "$model_bin" ]]; then
    echo "Missing model for $model: set SEEKITE_${model^^}_MODEL to an absolute packed model path" >&2
    exit 1
  fi

  cp "$model_bin" "$native_dir/assets/model.bin"
  (
    cd "$native_dir"
    wasm-pack build --target nodejs --release --features emb_int4 --out-dir "pkg-$model-node"
    wasm-pack build --target bundler --release --features emb_int4 --out-dir "pkg-$model-bundler"
  )

  mkdir -p "$output_dir/node" "$output_dir/bundler"
  cp "$native_dir/pkg-$model-node/tern_engine.js" "$native_dir/pkg-$model-node/tern_engine.d.ts" "$native_dir/pkg-$model-node/tern_engine_bg.wasm.d.ts" "$output_dir/node/"
  cp "$native_dir/pkg-$model-node/tern_engine_bg.wasm" "$output_dir/tern_engine_bg.wasm"
  cp "$native_dir/pkg-$model-bundler/tern_engine.js" "$native_dir/pkg-$model-bundler/tern_engine.d.ts" "$native_dir/pkg-$model-bundler/tern_engine_bg.wasm.d.ts" "$output_dir/bundler/"
  cp "$native_dir/pkg-$model-bundler/tern_engine_bg.js" "$output_dir/tern_engine_bg.js"

  # Both loaders share one Wasm file. Keep their paths stable across wasm-pack versions.
  sed -i 's|`${__dirname}/tern_engine_bg.wasm`|`${__dirname}/../tern_engine_bg.wasm`|' "$output_dir/node/tern_engine.js"
  sed -i 's|"./tern_engine_bg.wasm"|"../tern_engine_bg.wasm"|' "$output_dir/bundler/tern_engine.js"
  sed -i 's|"./tern_engine_bg.js"|"../tern_engine_bg.js"|g' "$output_dir/bundler/tern_engine.js"
  printf '{ "type": "commonjs" }\n' > "$output_dir/node/package.json"
}

build_model "mini" "${SEEKITE_MINI_MODEL:-}"
build_model "base" "${SEEKITE_BASE_MODEL:-}"

echo "Seekite embedding Wasm rebuilt in $package_dir/wasm"
