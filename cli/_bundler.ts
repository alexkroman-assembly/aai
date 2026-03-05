import { build, type BuildOptions, initialize, type Plugin } from "esbuild";
import { denoPlugin } from "@deno/esbuild-plugin";
import { dirname, fromFileUrl, resolve, toFileUrl } from "@std/path";
import type { AgentEntry } from "./_discover.ts";

let esbuildReady: Promise<void> | null = null;

/** Ensure esbuild-wasm is initialized (needed inside deno compile). */
function ensureInit() {
  if (!esbuildReady) {
    esbuildReady = initialize({}).catch(() => {
      // Already initialized — ignore
      esbuildReady = null;
    });
  }
  return esbuildReady;
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
  const { agentToolsToSchemas } = await import("../server/agent_types.ts");
  const { defineAgent } = await import("../server/agent.ts");
  const { fetchJSON } = await import("../server/fetch_json.ts");
  const { z } = await import("zod");
  Object.assign(globalThis, { defineAgent, fetchJSON, z });

  const mod = await import(toFileUrl(resolve(agent.entryPoint)).href);
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
      `import { z } from "zod";\n` +
      `Object.assign(globalThis, { defineAgent, fetchJSON, z });\n`,
  );

  const clientShimPath = resolve(outDir, "_client_shim.ts");
  await Deno.writeTextFile(
    clientShimPath,
    `import { mount, useSession, css, keyframes, styled, darkTheme, defaultTheme, applyTheme, App, ChatView, ErrorBanner, MessageBubble, StateIndicator, Transcript, SessionProvider, createSessionControls, VoiceSession } from "@aai/ui";\n` +
      `import { useEffect, useRef, useState, useCallback, useMemo } from "preact/hooks";\n` +
      `Object.assign(globalThis, { mount, useSession, css, keyframes, styled, darkTheme, defaultTheme, applyTheme, App, ChatView, ErrorBanner, MessageBubble, StateIndicator, Transcript, SessionProvider, createSessionControls, VoiceSession, useEffect, useRef, useState, useCallback, useMemo });\n`,
  );

  const workerResult = await build({
    ...BASE,
    plugins: [denoPlugin({ configPath })],
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

  let clientBytes = 0;
  if (!opts?.skipClient) {
    const clientResult = await build({
      ...clientBuildOptions(agent.clientEntry, `${outDir}/client.js`),
      inject: [clientShimPath],
      metafile: true,
    });
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
