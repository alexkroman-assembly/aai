import { parseArgs } from "@std/cli/parse-args";
import { debounce } from "@std/async/debounce";
import { encodeBase64 } from "@std/encoding/base64";
import { bold, cyan, dim, green } from "@std/fmt/colors";
import { error, stepInfo } from "./_output.ts";
import { runBuild } from "./build.ts";
import type { AgentEntry } from "./_discover.ts";
import {
  createWebSocketTarget,
  type RpcHandlers,
  serveRpc,
} from "@aai/core/rpc";
import { createDenoWorker } from "@aai/core/deno-worker";
import { createWorkerApi } from "@aai/core/worker-entry";

import { DEFAULT_SERVER } from "./_discover.ts";

function spawnLocalWorker(
  workerCode: string,
  slug: string,
): { workerApi: ReturnType<typeof createWorkerApi>; terminate: () => void } {
  const workerUrl = `data:application/javascript;base64,${
    encodeBase64(workerCode)
  }`;
  const worker = createDenoWorker(workerUrl, `dev-${slug}`, {
    net: true,
    read: false,
    env: false,
    run: false,
    write: false,
    ffi: false,
    sys: false,
  });
  return {
    workerApi: createWorkerApi(worker),
    terminate: () => worker.terminate(),
  };
}

/** Convert an HTTP(S) URL to its WebSocket equivalent. */
function toWsUrl(httpUrl: string): string {
  const u = new URL(httpUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString().replace(/\/$/, "");
}

export async function runDevCommand(args: string[]): Promise<number> {
  const flags = parseArgs(args, {
    string: ["port", "server"],
    alias: { h: "help", p: "port", s: "server" },
    boolean: ["help"],
  });

  if (flags.help) {
    console.log(
      `${green(bold("aai dev"))} — Run local dev server with file watching

${bold("USAGE:")}
  ${cyan("aai dev")}

${bold("OPTIONS:")}
  ${cyan("-p, --port")} ${
        dim("<number>")
      }   Port for local proxy server (default: 3000)
  ${cyan("-s, --server")} ${
        dim("<url>")
      } Production server URL (default: ${DEFAULT_SERVER})
  ${cyan("-h, --help")}             Show this help message
`,
    );
    return 0;
  }

  const cwd = Deno.env.get("INIT_CWD") || Deno.cwd();
  const port = parseInt(flags.port ?? "3000");
  const serverUrl = flags.server ?? DEFAULT_SERVER;

  const {
    ensureClaudeMd,
    getApiKey,
    getNamespace,
    resolveSlug,
    saveAgentLink,
  } = await import(
    "./_discover.ts"
  );
  const apiKey = await getApiKey();
  const namespace = await getNamespace();

  await ensureClaudeMd(cwd);

  let result;
  try {
    result = await runBuild({ agentDir: cwd });
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const slug = await resolveSlug(cwd, namespace, result.agent.slug);
  const fullPath = `${namespace}/${slug}`;

  await saveAgentLink(cwd, { namespace, slug, apiKey });

  let localWorker = spawnLocalWorker(
    result.bundle.worker,
    slug,
  );

  let manifest = JSON.parse(result.bundle.manifest);
  let clientCode = result.bundle.client;

  const wsUrl = toWsUrl(serverUrl);
  let controlWs = await connectAndRegister(
    wsUrl,
    apiKey,
    namespace,
    result.agent,
    manifest,
    clientCode,
    localWorker,
  );

  const proxyServer = startLocalProxy(
    port,
    fullPath,
    manifest.config?.name ?? slug,
    serverUrl,
    () => clientCode,
  );

  printReady(result.agent, namespace, port);

  const ac = new AbortController();
  const watcher = Deno.watchFs([cwd], { recursive: true });

  const WATCHED_EXTENSIONS = [
    ".ts",
    ".tsx",
    ".json",
    ".md",
    ".csv",
    ".txt",
    ".html",
  ];

  let building = false;
  let pendingRebuild = false;

  const rebuild = debounce(async () => {
    if (building) {
      pendingRebuild = true;
      return;
    }
    building = true;
    try {
      const freshResult = await runBuild({ agentDir: cwd });

      localWorker.terminate();
      localWorker = spawnLocalWorker(
        freshResult.bundle.worker,
        slug,
      );
      manifest = JSON.parse(freshResult.bundle.manifest);
      clientCode = freshResult.bundle.client;

      controlWs.close();
      controlWs = await connectAndRegister(
        wsUrl,
        apiKey,
        namespace,
        freshResult.agent,
        manifest,
        clientCode,
        localWorker,
      );

      printReady(freshResult.agent, namespace, port);
    } catch (err: unknown) {
      error(err instanceof Error ? err.message : String(err));
    } finally {
      building = false;
      if (pendingRebuild) {
        pendingRebuild = false;
        rebuild();
      }
    }
  }, 300);

  const cleanup = () => {
    ac.abort();
    watcher.close();
    localWorker.terminate();
    controlWs.close();
    proxyServer.shutdown();
  };

  Deno.addSignalListener("SIGINT", cleanup);
  Deno.addSignalListener("SIGTERM", cleanup);

  for await (const event of watcher) {
    if (ac.signal.aborted) break;
    const hasRelevantChange = event.paths.some((p) =>
      WATCHED_EXTENSIONS.some((ext) => p.endsWith(ext))
    );
    if (!hasRelevantChange) continue;
    if (event.paths.every((p) => p.includes("_test.ts"))) continue;
    rebuild();
  }

  return 0;
}

function connectAndRegister(
  wsUrl: string,
  apiKey: string,
  namespace: string,
  agent: AgentEntry,
  manifest: {
    config?: {
      name?: string;
      instructions: string;
      greeting: string;
      voice: string;
      prompt?: string;
      builtinTools?: string[];
    };
    toolSchemas?: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }[];
  },
  clientCode: string,
  localWorker: ReturnType<typeof spawnLocalWorker>,
): Promise<WebSocket> {
  const fullPath = `${namespace}/${agent.slug}`;
  const url = `${wsUrl}/${fullPath}/dev?token=${encodeURIComponent(apiKey)}`;

  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        type: "dev_register",
        config: manifest.config ?? {
          instructions: "",
          greeting: "",
          voice: "luna",
        },
        toolSchemas: manifest.toolSchemas ?? [],
        env: agent.env,
        transport: agent.transport,
        client: clientCode,
      }));
    });

    ws.addEventListener("message", function onRegAck(event) {
      if (typeof event.data !== "string") return;
      let msg: { type?: string; slug?: string; message?: string };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (typeof (msg as Record<string, unknown>).id === "number") return;

      if (msg.type === "dev_registered") {
        ws.removeEventListener("message", onRegAck);

        const target = createWebSocketTarget(ws);
        const handlers: RpcHandlers = {
          executeTool: (req) =>
            localWorker.workerApi.executeTool(
              req.name,
              req.args,
              undefined,
              30_000,
            ),
          invokeHook: (req) =>
            localWorker.workerApi.invokeHook(
              req.hook,
              req.sessionId,
              { text: req.text, error: req.error },
              5_000,
            ),
        };
        serveRpc(target, handlers);

        resolve(ws);
      } else if (msg.type === "dev_error") {
        reject(new Error(msg.message ?? "Server rejected registration"));
      }
    });

    ws.addEventListener("error", (event) => {
      const msg = event instanceof ErrorEvent
        ? event.message
        : "WebSocket error";
      reject(new Error(`Failed to connect to server: ${msg}`));
    });

    ws.addEventListener("close", (event) => {
      if (!event.wasClean) {
        error(`Control WebSocket closed: ${event.reason || "connection lost"}`);
      }
    });
  });
}

function startLocalProxy(
  port: number,
  fullPath: string,
  agentName: string,
  serverUrl: string,
  getClientCode: () => string,
): Deno.HttpServer {
  const wsUrl = toWsUrl(serverUrl);

  return Deno.serve(
    { port, hostname: "0.0.0.0", onListen: () => {} },
    async (req: Request) => {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path === `/${fullPath}`) {
        return Response.redirect(
          `http://localhost:${port}/${fullPath}/`,
          301,
        );
      }
      if (path === `/${fullPath}/`) {
        return new Response(renderDevPage(agentName, `/${fullPath}`), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (path === `/${fullPath}/client.js`) {
        return new Response(getClientCode(), {
          headers: {
            "Content-Type": "application/javascript",
            "Cache-Control": "no-cache",
          },
        });
      }

      if (path === `/${fullPath}/websocket`) {
        if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
          return Response.json(
            { error: "Expected WebSocket upgrade" },
            { status: 400 },
          );
        }

        const { socket: clientWs, response } = Deno.upgradeWebSocket(req);
        const targetUrl = `${wsUrl}/${fullPath}/websocket${url.search}`;
        const serverWs = new WebSocket(targetUrl);
        serverWs.binaryType = "arraybuffer";

        serverWs.addEventListener("open", () => {
          clientWs.addEventListener("message", (e) => {
            if (serverWs.readyState === WebSocket.OPEN) {
              serverWs.send(e.data);
            }
          });
        });

        serverWs.addEventListener("message", (e) => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(e.data);
          }
        });

        serverWs.addEventListener("close", () => {
          if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
        });
        clientWs.addEventListener("close", () => {
          if (serverWs.readyState === WebSocket.OPEN) serverWs.close();
        });
        serverWs.addEventListener("error", () => {
          if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
        });
        clientWs.addEventListener("error", () => {
          if (serverWs.readyState === WebSocket.OPEN) serverWs.close();
        });

        return response;
      }

      if (path === "/favicon.ico" || path === "/favicon.svg") {
        try {
          return await fetch(`${serverUrl}${path}`);
        } catch {
          return new Response(null, { status: 404 });
        }
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    },
  );
}

function renderDevPage(name: string, basePath: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(name)}</title>
    <meta name="description" content="${esc(name)} — AI voice agent">
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  </head>
  <body>
    <main id="app"></main>
    <script type="module" src="${esc(basePath)}/client.js"></script>
  </body>
</html>`;
}

function printReady(
  agent: AgentEntry,
  namespace: string,
  port: number,
): void {
  const fullPath = `${namespace}/${agent.slug}`;
  const url = `http://localhost:${port}/${fullPath}/`;
  console.log(`\n  ${green(bold(url))}\n`);
  stepInfo("Watch", "for changes...");
}
