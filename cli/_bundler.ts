// Copyright 2025 the AAI authors. MIT license.
import { join } from "@std/path";
import { denoExec } from "./_discover.ts";
import type { AgentEntry } from "./_discover.ts";

/**
 * Error thrown when bundling fails.
 *
 * @param message Human-readable error message (typically formatted build output).
 */
export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleError";
  }
}

/** Output artifacts produced by {@linkcode bundleAgent}. */
export type BundleOutput = {
  /** Minified ESM JavaScript for the server-side Deno Worker. */
  worker: string;
  /** Single-file HTML page with inlined client JS and CSS. */
  html: string;
  /** JSON manifest containing env var names and transport configuration. */
  manifest: string;
  /** Size of the worker bundle in bytes. */
  workerBytes: number;
};

/** Internal helpers exposed for testing. Not part of the public API. */
export const _internals = {
  BundleError,
};

/**
 * Deno build script generated at build time into `.aai/_build.mts`.
 *
 * Runs under Deno (not Node), so it can import JSR packages like @deno/loader
 * directly. Uses Vite's JS API to build the worker + client bundles.
 */
const BUILD_SCRIPT = `\
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { Workspace, ResolutionMode, RequestedModuleType } from "@deno/loader";
import { transform } from "esbuild";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skipClient = Deno.env.get("AAI_SKIP_CLIENT") === "1";

// --- @deno/loader plugin (same approach as Fresh) ---

function denoLoader(loader) {
  return {
    name: "aai-deno",
    enforce: "pre",
    async resolveId(id, importer) {
      if (id.startsWith("\\0")) return;

      // Unwrap virtual deno specifier importers
      if (importer && importer.startsWith("\\0deno::")) {
        importer = importer.slice("\\0deno::".length);
      }

      // Let other pre-plugins resolve first (but skip vite:resolve)
      const other = await this.resolve(id, importer, { skipSelf: true });
      if (other && other.resolvedBy !== "vite:resolve") {
        if (other.external || other.id.startsWith("\\0")) return other;
        id = other.id;
      }

      if (isAbsolute(id)) id = "file://" + id;

      try {
        const ref = importer && !importer.startsWith("\\0") ? importer : undefined;
        const resolved = await loader.resolve(id, ref, ResolutionMode.Import);

        if (resolved.startsWith("node:"))
          return { id: resolved, external: true };

        // npm: → strip prefix + version, let Vite resolve from node_modules
        if (resolved.startsWith("npm:")) {
          let bare = resolved.replace(/^npm:\\//, "");
          const vAt = bare.indexOf("@", bare.startsWith("@") ? 1 : 0);
          if (vAt > 0) {
            const after = bare.slice(vAt);
            const slash = after.indexOf("/");
            bare = bare.slice(0, vAt) + (slash > -1 ? after.slice(slash) : "");
          }
          return (await this.resolve(bare, undefined, { skipSelf: true })) ?? bare;
        }

        if (resolved.startsWith("file://")) return fileURLToPath(resolved);

        // Remote (jsr:/https:) → virtual module for load()
        return "\\0deno::" + resolved;
      } catch {
        // Not resolvable by Deno
      }
    },

    async load(id) {
      if (!id.startsWith("\\0deno::")) return;
      const specifier = id.slice("\\0deno::".length);

      const result = await loader.load(specifier, RequestedModuleType.Default);
      if (result.kind === "external") return null;

      const code = new TextDecoder().decode(result.code);
      const ext = specifier.split(".").pop() || "";
      const loaderMap = { ts: "ts", tsx: "tsx", jsx: "jsx", mts: "ts" };
      const esbuildLoader = loaderMap[ext];
      if (esbuildLoader) {
        const out = await transform(code, {
          format: "esm", loader: esbuildLoader, logLevel: "warning",
        });
        return { code: out.code, map: out.map || null };
      }
      return code;
    },
  };
}

// --- Virtual worker entry ---

function workerEntry() {
  const id = "virtual:worker-entry";
  const resolved = "\\0" + id;
  return {
    name: "aai-worker-entry",
    enforce: "pre",
    resolveId(source) { if (source === id) return resolved; },
    load(source) {
      if (source === resolved) {
        return [
          \`import agent from "\${resolve(root, "agent.ts")}";\`,
          \`import { initWorker } from "@aai/sdk";\`,
          \`initWorker(agent);\`,
        ].join("\\n");
      }
    },
  };
}

// --- Build ---

const loader = await new Workspace({
  platform: "browser",
  cachedOnly: true,
}).createLoader();

const deno = denoLoader(loader);

// Pre-resolve @aai/ui sources to disk so Tailwind can scan them for class names.
// @tailwindcss/vite only scans on-disk files, not virtual modules from the deno loader.
async function writeUiSources() {
  const sourcesDir = resolve(root, ".aai", "sources");
  mkdirSync(sourcesDir, { recursive: true });
  try {
    const modUrl = await loader.resolve("@aai/ui", undefined, ResolutionMode.Import);
    const queue = [modUrl];
    const seen = new Set();
    let count = 0;
    while (queue.length > 0) {
      const url = queue.shift();
      if (seen.has(url)) continue;
      seen.add(url);
      try {
        const result = await loader.load(url, RequestedModuleType.Default);
        if (result.kind === "external") continue;
        const code = new TextDecoder().decode(result.code);
        writeFileSync(resolve(sourcesDir, \`mod\${count++}.ts\`), code);
        // Follow relative imports
        const baseUrl = url.replace(/\\/[^\\/]+$/, "");
        for (const m of code.matchAll(/from\\s+['"](\\.\\/[^'"]+)['"]/g)) {
          queue.push(baseUrl + "/" + m[1].replace(/^\\.\\//,""));
        }
      } catch { /* skip */ }
    }
  } catch { /* @aai/ui not resolvable */ }
}

function buildClient() {
  return {
    name: "aai-build-client",
    async closeBundle() {
      const hasClient = existsSync(resolve(root, "client.tsx"));
      if (skipClient || !hasClient) return;
      await writeUiSources();
      await build({
        configFile: false,
        root: resolve(root, ".aai"),
        plugins: [deno, preact(), tailwindcss(), viteSingleFile()],
        build: {
          outDir: resolve(root, ".aai/build"),
          emptyOutDir: false,
          minify: true,
        },
      });
    },
  };
}

await build({
  configFile: false,
  root,
  plugins: [deno, workerEntry(), buildClient()],
  build: {
    outDir: resolve(root, ".aai/build"),
    emptyOutDir: true,
    minify: true,
    target: "es2022",
    rollupOptions: {
      input: "virtual:worker-entry",
      output: {
        format: "es",
        entryFileNames: "worker.js",
        inlineDynamicImports: true,
      },
    },
  },
});
`;

/** Fallback HTML shell generated when no client.tsx exists. */
const INDEX_HTML = `\
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, viewport-fit=cover"
    />
    <title>aai</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="../styles.css" />
  </head>
  <body>
    <main id="app"></main>
    <script type="module" src="../client.tsx"></script>
  </body>
</html>
`;

/**
 * Bundles an agent project into deployable artifacts using Vite.
 *
 * The CLI generates a temporary vite config in `.aai/` so users never
 * need a `vite.config` in their project directory (like Vercel / Cloudflare).
 *
 * @param agent The discovered agent entry containing paths and configuration.
 * @param opts Optional settings. Set `skipClient` to omit the client bundle.
 * @returns The bundled worker code, single-file HTML, manifest, and byte sizes.
 * @throws {BundleError} If Vite encounters a build error.
 */
export async function bundleAgent(
  agent: AgentEntry,
  opts?: { skipClient?: boolean },
): Promise<BundleOutput> {
  const aaiDir = join(agent.dir, ".aai");
  await Deno.mkdir(aaiDir, { recursive: true });

  // Generate build script and HTML shell into .aai/
  const buildScript = join(aaiDir, "_build.mts");
  await Deno.writeTextFile(buildScript, BUILD_SCRIPT);
  await Deno.writeTextFile(join(aaiDir, "index.html"), INDEX_HTML);

  const skipClient = opts?.skipClient || !agent.clientEntry;
  const env: Record<string, string> = { ...Deno.env.toObject() };
  if (skipClient) {
    env.AAI_SKIP_CLIENT = "1";
  }

  const cmd = new Deno.Command(denoExec(), {
    args: ["run", "--allow-all", buildScript],
    cwd: agent.dir,
    stdout: "piped",
    stderr: "piped",
    env,
  });

  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) {
    throw new BundleError(
      new TextDecoder().decode(stderr) ||
        new TextDecoder().decode(stdout),
    );
  }

  const worker = await Deno.readTextFile(
    join(aaiDir, "build", "worker.js"),
  );

  const htmlPath = skipClient
    ? join(aaiDir, "index.html")
    : join(aaiDir, "build", "index.html");
  const html = await Deno.readTextFile(htmlPath);

  const manifest = JSON.stringify(
    { transport: agent.transport },
    null,
    2,
  );

  return {
    worker,
    html,
    manifest,
    workerBytes: new TextEncoder().encode(worker).length,
  };
}
