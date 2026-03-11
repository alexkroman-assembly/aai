import {
  build,
  type BuildOptions,
  formatMessages,
  initialize,
  type Plugin,
  transform,
} from "esbuild";
import type { InitializeOptions } from "esbuild-wasm-types";
import { denoPlugin } from "@deno/esbuild-plugin";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { toFileUrl } from "@std/path/to-file-url";
import type { AgentEntry } from "./_discover.ts";

export function bundleError(message: string): Error {
  const err = new Error(message);
  err.name = "BundleError";
  return err;
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
      throw bundleError(formatted.join("\n"));
    }
    throw err;
  }
}

let esbuildReady: Promise<void> | null = null;

function ensureInit() {
  if (!esbuildReady) {
    esbuildReady = (async () => {
      const esbuildDir = dirname(fromFileUrl(import.meta.resolve("esbuild")));
      const wasmPath = join(esbuildDir, "..", "esbuild.wasm");
      const wasmBytes = await Deno.readFile(wasmPath);
      const wasmModule = new WebAssembly.Module(wasmBytes);
      await initialize(
        { wasmModule, worker: false } as unknown as InitializeOptions,
      );
    })().catch(() => {
      esbuildReady = null;
    });
  }
  return esbuildReady;
}

async function stripTypes(source: string): Promise<string> {
  await ensureInit();
  const result = await transform(source, { loader: "ts" });
  return result.code;
}

export const AAI_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const baseConfigPath = resolve(AAI_ROOT, "_bundler_config.json");

/**
 * Resolves workspace package specifiers (@aai/sdk/*, @aai/core/*, @aai/ui)
 * to local file paths. The @deno/esbuild-plugin's Workspace resolver converts
 * these to jsr: specifiers that the WASM loader can't fetch, so we intercept
 * them first and point directly to the source files.
 */
const WORKSPACE_ALIASES: Record<string, string> = {
  "@aai/sdk": resolve(AAI_ROOT, "sdk/mod.ts"),
  "@aai/sdk/types": resolve(AAI_ROOT, "sdk/types.ts"),
  "@aai/sdk/schema": resolve(AAI_ROOT, "sdk/_schema.ts"),
  "@aai/sdk/define-agent": resolve(AAI_ROOT, "sdk/define_agent.ts"),
  "@aai/sdk/fetch-json": resolve(AAI_ROOT, "sdk/fetch_json.ts"),
  "@aai/sdk/kv": resolve(AAI_ROOT, "sdk/kv.ts"),
  "@aai/core/worker-entry": resolve(AAI_ROOT, "core/_worker_entry.ts"),
  "@aai/core/protocol": resolve(AAI_ROOT, "core/_protocol.ts"),
  "@aai/core/ws-endpoint": resolve(AAI_ROOT, "core/_ws_endpoint.ts"),
  "@aai/core/rpc-schema": resolve(AAI_ROOT, "core/_rpc_schema.ts"),
  "@aai/core/deno-worker": resolve(AAI_ROOT, "core/_deno_worker.ts"),
  "@aai/ui": resolve(AAI_ROOT, "ui/mod.ts"),
  "@aai/ui/types": resolve(AAI_ROOT, "ui/types.ts"),
  "@aai/ui/session": resolve(AAI_ROOT, "ui/session.ts"),
  "@aai/ui/signals": resolve(AAI_ROOT, "ui/signals.ts"),
  "@aai/ui/theme": resolve(AAI_ROOT, "ui/theme.ts"),
  "@aai/ui/mount": resolve(AAI_ROOT, "ui/mount.ts"),
  "@aai/ui/components": resolve(AAI_ROOT, "ui/_components.ts"),
  "@aai/ui/audio": resolve(AAI_ROOT, "ui/audio.ts"),
  "@aai/ui/resample": resolve(AAI_ROOT, "ui/resample.ts"),
  "@aai/ui/html": resolve(AAI_ROOT, "ui/_html.ts"),
  "@aai/ui/client": resolve(AAI_ROOT, "ui/client.ts"),
};

/**
 * Resolves an npm package name to its entry point file path under node_modules.
 * Returns undefined if the package cannot be found.
 */
function resolveNpmPackage(
  name: string,
  subpath?: string,
): string | undefined {
  const pkgDir = join(AAI_ROOT, "node_modules", ...name.split("/"));
  try {
    if (subpath) {
      // e.g. preact/hooks → node_modules/preact/hooks/index.js or hooks.js
      const sub = join(pkgDir, subpath);
      try {
        const info = Deno.statSync(sub);
        if (info.isDirectory) {
          const pkgJson = join(sub, "package.json");
          try {
            const pkg = JSON.parse(Deno.readTextFileSync(pkgJson));
            return resolve(sub, pkg.module || pkg.main || "index.js");
          } catch {
            return resolve(sub, "index.js");
          }
        }
      } catch { /* not a directory */ }
      // Try as a file
      for (const ext of ["", ".js", ".mjs"]) {
        try {
          Deno.statSync(sub + ext);
          return sub + ext;
        } catch { /* try next */ }
      }
    }
    const pkgJson = join(pkgDir, "package.json");
    const pkg = JSON.parse(Deno.readTextFileSync(pkgJson));
    return resolve(pkgDir, pkg.module || pkg.main || "index.js");
  } catch {
    return undefined;
  }
}

/**
 * npm packages used by the framework (ui/, sdk/, core/).
 * Resolved directly to node_modules entry points so the deno esbuild plugin
 * doesn't need to find them — critical for compiled binaries where the deno
 * plugin's npm resolver can't locate node_modules.
 */
const NPM_PACKAGE_NAMES = [
  "preact",
  "preact/hooks",
  "@preact/signals",
  "htm",
  "comlink",
];

function buildNpmAliases(): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const name of NPM_PACKAGE_NAMES) {
    const parts = name.split("/");
    const pkgName = name.startsWith("@")
      ? parts.slice(0, 2).join("/")
      : parts[0];
    const subpath = name.startsWith("@")
      ? parts.slice(2).join("/")
      : parts.slice(1).join("/");
    const resolved = resolveNpmPackage(pkgName, subpath || undefined);
    if (resolved) aliases[name] = resolved;
  }
  return aliases;
}

let npmAliases: Record<string, string> | null = null;

function workspaceAliasPlugin(): Plugin {
  if (!npmAliases) npmAliases = buildNpmAliases();
  return {
    name: "workspace-alias",
    setup(build) {
      build.onResolve({ filter: /^@aai\// }, (args) => {
        const local = WORKSPACE_ALIASES[args.path];
        if (local) return { path: local, namespace: "file" };
        return null;
      });
      // Resolve framework npm packages directly to node_modules entry points.
      // This avoids relying on the deno plugin's npm resolver, which fails in
      // compiled binaries where node_modules aren't fully available.
      build.onResolve(
        { filter: /^(preact|@preact\/signals|htm|comlink)/ },
        (args) => {
          const resolved = npmAliases![args.path];
          if (resolved) return { path: resolved, namespace: "file" };
          return null;
        },
      );
    },
  };
}

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

function jsBytes(metafile: { outputs: Record<string, { bytes: number }> }) {
  for (const [file, info] of Object.entries(metafile.outputs)) {
    if (file.endsWith(".js")) return info.bytes;
  }
  return 0;
}

function getOutputText(
  result: { outputFiles?: { path: string; text: string }[] },
): string {
  return result.outputFiles?.[0]?.text ?? "";
}

export async function importTempModule(
  sourcePath: string,
  opts?: { rewriteSdkImports?: boolean },
): Promise<Record<string, unknown>> {
  const absPath = resolve(sourcePath);
  const dir = dirname(absPath);
  const source = await Deno.readTextFile(absPath);
  let js = await stripTypes(source);
  if (opts?.rewriteSdkImports) {
    const sdkPath = toFileUrl(resolve(AAI_ROOT, "sdk/mod.ts")).href;
    js = js.replace(
      /from\s*["']@aai\/sdk["']/g,
      `from "${sdkPath}"`,
    );
  }
  js = js.replace(
    /from\s*["'](\.\.?\/[^"']+)["']/g,
    (_, rel: string) => `from "${toFileUrl(resolve(dir, rel)).href}"`,
  );
  const dataUrl = `data:application/javascript;charset=utf-8,${
    encodeURIComponent(js)
  }`;
  return await import(dataUrl);
}

export type BundleOutput = {
  worker: string;
  client: string;
  manifest: string;
  workerBytes: number;
  clientBytes: number;
};

export async function bundleAgent(
  agent: AgentEntry,
  opts?: { skipClient?: boolean },
): Promise<BundleOutput> {
  await ensureInit();

  const agentAbsolute = resolve(agent.entryPoint);
  const workerEntryAbsolute = resolve(AAI_ROOT, "core/_worker_entry.ts");

  const alias = workspaceAliasPlugin();
  const workerPlugins = [alias, denoPlugin({ configPath: baseConfigPath })];
  const clientPlugins = [alias, denoPlugin({ configPath: baseConfigPath })];

  const workerResult = await buildWithCleanErrors({
    ...BASE,
    plugins: workerPlugins,
    nodePaths: [join(agent.dir, "node_modules")],

    stdin: {
      contents: `import agent from "${agentAbsolute}";\n` +
        `import { startWorker } from "${workerEntryAbsolute}";\n` +
        `const env: Record<string, string> = ${JSON.stringify(agent.env)};\n` +
        `startWorker(agent, env);\n`,
      loader: "ts",
      resolveDir: AAI_ROOT,
    },
    outfile: "worker.js",
    metafile: true,
    loader: {
      ".json": "json",
      ".txt": "text",
      ".md": "text",
      ".csv": "text",
      ".html": "text",
    },
  });

  let client = "";
  let clientBytes = 0;
  if (!opts?.skipClient) {
    const clientEntry = agent.clientEntry.startsWith(agent.dir)
      ? `import { mount } from "@aai/ui";\n` +
        `import App from "${resolve(agent.clientEntry)}";\n` +
        `mount(App, { platformUrl: new URL(".", globalThis.location.href).href.replace(/\\/$/, "") });\n`
      : `import "${resolve(agent.clientEntry)}";\n`;

    const clientResult = await buildWithCleanErrors({
      ...BASE,
      plugins: clientPlugins,
      nodePaths: [join(agent.dir, "node_modules")],

      stdin: {
        contents: clientEntry,
        loader: "tsx",
        resolveDir: AAI_ROOT,
      },
      outfile: "client.js",
      jsx: "automatic",
      jsxImportSource: "preact",
      metafile: true,
    });
    client = getOutputText(clientResult);
    clientBytes = jsBytes(clientResult.metafile!);
  }

  const manifest = JSON.stringify(
    {
      env: agent.env,
      transport: agent.transport,
      config: agent.config,
      toolSchemas: agent.toolSchemas,
    },
    null,
    2,
  );

  return {
    worker: getOutputText(workerResult),
    client,
    manifest,
    workerBytes: jsBytes(workerResult.metafile!),
    clientBytes,
  };
}
