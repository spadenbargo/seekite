/* @ts-self-types="./tern_engine.d.ts" */
import * as wasm from "../tern_engine_bg.wasm";
import { __wbg_set_wasm } from "../tern_engine_bg.js";

__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    config_summary, embed, tokenize
} from "../tern_engine_bg.js";
