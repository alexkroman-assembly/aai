import {
  build,
  type BuildOptions,
  formatMessages,
  initialize,
  type Plugin,
} from "esbuild";
import { denoPlugin } from "@deno/esbuild-plugin";
import { dirname, fromFileUrl, resolve, toFileUrl } from "@std/path";
import type { AgentEntry } from "./_discover.ts";

export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleError";
  }
}

async function buildWithCleanErrors(
  options: BuildOptions,
): ReturnType<typeof build> {
  try {
    return await build(options);
  } catch (err: unknown) {
    if (
      err && typeof err === "object" && "errors" in err &&
      Array.isArray((err as { errors: unknown[] }).errors)
    ) {
      const errors = (err as { errors: unknown[] }).errors as Parameters<
        typeof formatMessages
      >[0];
      const formatted = await formatMessages(errors, {
        kind: "error",
        color: true,
      });
      throw new BundleError(formatted.join("\n"));
    }
    throw err;
  }
}

let esbuildReady: Promise<void> | null = null;

/** Ensure esbuild-wasm is initialized (needed inside deno compile). */
function ensureInit() {
  if (!esbuildReady) {
    esbuildReady = (async () => {
      // The browser ESM build of esbuild-wasm needs the WASM binary loaded
      // explicitly. Provide it as a compiled WebAssembly.Module.
      const wasmPath = resolve(
        dirname(fromFileUrl(import.meta.url)),
        "..",
        "node_modules",
        ".deno",
        "esbuild-wasm@0.27.3",
        "node_modules",
        "esbuild-wasm",
        "esbuild.wasm",
      );
      const wasmBytes = await Deno.readFile(wasmPath);
      const wasmModule = new WebAssembly.Module(wasmBytes);
      await initialize({ wasmModule, worker: false });
    })().catch(() => {
      // Already initialized — ignore
      esbuildReady = null;
    });
  }
  return esbuildReady;
}

let cacheWarmed = false;

/** Pre-populate Deno's npm cache so esbuild resolution doesn't trigger noisy
 *  download logs mid-build. Safe to call multiple times — only runs once. */
export async function warmNpmCache(): Promise<void> {
  if (cacheWarmed) return;
  cacheWarmed = true;
  await ensureInit();
  // Dynamic imports trigger Deno's npm resolution and cache the packages.
  // These are the npm specifiers from the root deno.json import map that
  // denoPlugin will resolve during bundling.
  await Promise.allSettled([
    import("preact"),
    import("preact/hooks"),
    import("preact/compat"),
    import("@preact/signals"),
    import("goober"),
  ]);
}

/** Root of the aai framework (parent of cli/). */
const AAI_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const configPath = resolve(AAI_ROOT, "deno.json");

/** Loads .worklet.js files as text strings so they can be passed to
 *  AudioContext.audioWorklet.addModule() at runtime. Must be listed
 *  before denoPlugin so it intercepts the resolve first. */
const workletTextPlugin: Plugin = {
  name: "worklet-text",
  setup(build) {
    build.onResolve({ filter: /\.worklet\.js$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path),
      namespace: "worklet-text",
    }));
    build.onLoad(
      { filter: /.*/, namespace: "worklet-text" },
      async (args) => ({
        contents: await Deno.readTextFile(args.path),
        loader: "text" as const,
      }),
    );
  },
};

const BASE: BuildOptions = {
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  mainFields: ["module", "main"],
  target: "es2022",
  treeShaking: true,
  minify: true,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
  drop: ["debugger"],
  logOverride: { "commonjs-variable-in-esm": "silent" },
};

/** Write esbuild output files to disk (browser ESM build doesn't support write:true). */
async function writeOutputFiles(
  result: { outputFiles?: { path: string; contents: Uint8Array }[] },
): Promise<void> {
  if (!result.outputFiles) return;
  for (const file of result.outputFiles) {
    await Deno.writeFile(file.path, file.contents);
  }
}

export function clientBuildOptions(
  clientEntry: string,
  outfile: string,
): BuildOptions {
  return {
    ...BASE,
    plugins: [workletTextPlugin, denoPlugin({ configPath })],
    entryPoints: [clientEntry],
    outfile,
    jsx: "automatic",
    jsxImportSource: "preact",
  };
}

async function precomputeSchemas(agent: AgentEntry) {
  // Agents with npm deps can't be dynamically imported in this process —
  // return null and let the worker compute schemas at runtime.
  if (agent.hasNpmDeps) return null;

  const { agentToolsToSchemas } = await import("../server/agent_types.ts");
  const { defineAgent } = await import("../server/agent.ts");
  const { fetchJSON } = await import("../server/fetch_json.ts");
  Object.assign(globalThis, { defineAgent, fetchJSON });

  const mod = await import(
    `${toFileUrl(resolve(agent.entryPoint)).href}?t=${Date.now()}`
  );
  return agentToolsToSchemas(mod.default.tools);
}

function jsBytes(metafile: { outputs: Record<string, { bytes: number }> }) {
  for (const [file, info] of Object.entries(metafile.outputs)) {
    if (file.endsWith(".js")) return info.bytes;
  }
  return 0;
}

export interface BundleResult {
  workerBytes: number;
  clientBytes: number;
}

export async function bundleAgent(
  agent: AgentEntry,
  outDir: string,
  opts?: { skipClient?: boolean },
): Promise<BundleResult> {
  await ensureInit();
  await Deno.mkdir(outDir, { recursive: true });

  const schemas = await precomputeSchemas(agent);

  const agentAbsolute = resolve(agent.entryPoint);
  const workerEntryAbsolute = resolve(AAI_ROOT, "server/worker_entry.ts");

  // Write temp shims that expose SDK/UI symbols as globals so import-free
  // agent files can reference defineAgent, z, fetchJSON, mount, etc. at runtime.
  const agentModAbsolute = resolve(AAI_ROOT, "server/agent.ts");
  const fetchJsonAbsolute = resolve(AAI_ROOT, "server/fetch_json.ts");

  const workerShimPath = resolve(outDir, "_worker_shim.ts");
  await Deno.writeTextFile(
    workerShimPath,
    `import { defineAgent } from "${agentModAbsolute}";\n` +
      `import { fetchJSON } from "${fetchJsonAbsolute}";\n` +
      `Object.assign(globalThis, { defineAgent, fetchJSON });\n`,
  );

  const clientShimPath = resolve(outDir, "_client_shim.ts");
  await Deno.writeTextFile(
    clientShimPath,
    `import { mount, useSession, css, keyframes, styled, darkTheme, defaultTheme, applyTheme, App, ChatView, ErrorBanner, MessageBubble, StateIndicator, Transcript, SessionProvider, createSessionControls, VoiceSession } from "@aai/ui";\n` +
      `import { useEffect, useRef, useState, useCallback, useMemo } from "preact/hooks";\n` +
      `Object.assign(globalThis, { mount, useSession, css, keyframes, styled, darkTheme, defaultTheme, applyTheme, App, ChatView, ErrorBanner, MessageBubble, StateIndicator, Transcript, SessionProvider, createSessionControls, VoiceSession, useEffect, useRef, useState, useCallback, useMemo });\n`,
  );

  // Plugin to resolve bare npm imports from the agent's node_modules
  // before denoPlugin (which only knows the aai project's import map).
  const agentNpmPlugin: Plugin = {
    name: "agent-npm",
    setup(b) {
      if (!agent.hasNpmDeps) return;
      const nmDir = resolve(agent.dir, "node_modules");
      b.onResolve({ filter: /^[^./]/ }, async (args) => {
        // Only intercept imports originating from the agent's directory
        if (!args.resolveDir.startsWith(agent.dir)) return undefined;
        const pkgDir = resolve(nmDir, args.path);
        try {
          await Deno.stat(pkgDir);
        } catch {
          return undefined; // fall through to denoPlugin
        }
        // Read the package.json to find the entry point
        try {
          const raw = await Deno.readTextFile(resolve(pkgDir, "package.json"));
          const pkg = JSON.parse(raw);
          const entry = pkg.module ?? pkg.main ?? "index.js";
          return { path: resolve(pkgDir, entry) };
        } catch {
          return { path: resolve(pkgDir, "index.js") };
        }
      });
    },
  };

  const workerResult = await buildWithCleanErrors({
    ...BASE,
    plugins: [agentNpmPlugin, denoPlugin({ configPath })],
    stdin: {
      contents: `import agent from "${agentAbsolute}";\n` +
        `import { startWorker } from "${workerEntryAbsolute}";\n` +
        `const secrets: Record<string, string> = ${
          JSON.stringify(agent.env)
        };\n` +
        `const schemas = ${JSON.stringify(schemas)};\n` +
        `startWorker(agent, secrets, schemas);\n`,
      loader: "ts",
      resolveDir: AAI_ROOT,
    },
    inject: [workerShimPath],
    outfile: `${outDir}/worker.js`,
    metafile: true,
    loader: {
      ".json": "json",
      ".txt": "text",
      ".md": "text",
      ".csv": "text",
      ".html": "text",
    },
  });
  await writeOutputFiles(workerResult);

  let clientBytes = 0;
  if (!opts?.skipClient) {
    const clientResult = await buildWithCleanErrors({
      ...clientBuildOptions(agent.clientEntry, `${outDir}/client.js`),
      inject: [clientShimPath],
      metafile: true,
    });
    await writeOutputFiles(clientResult);
    clientBytes = jsBytes(clientResult.metafile!);
  }

  // Clean up temp shims
  await Deno.remove(workerShimPath).catch(() => {});
  await Deno.remove(clientShimPath).catch(() => {});

  await Deno.writeTextFile(
    `${outDir}/manifest.json`,
    JSON.stringify(
      { slug: agent.slug, env: agent.env, transport: agent.transport },
      null,
      2,
    ) + "\n",
  );

  return {
    workerBytes: jsBytes(workerResult.metafile!),
    clientBytes,
  };
}
