// Re-export esbuild-wasm's browser ESM build which uses WebAssembly instead of
// spawning a native binary. This is required for `deno compile` where the
// esbuild native binary isn't available.
export {
  analyzeMetafile,
  build,
  context,
  formatMessages,
  initialize,
  stop,
  transform,
  version,
} from "npm:esbuild-wasm@^0.27.3/esm/browser.js";

export type {
  BuildOptions,
  InitializeOptions,
  Metafile,
  Plugin,
} from "npm:esbuild-wasm@^0.27.3";
