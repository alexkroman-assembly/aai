import { Command } from "@cliffy/command";
import { debounce } from "@std/async/debounce";
import { encodeBase64 } from "@std/encoding/base64";
import { bold, green } from "@std/fmt/colors";
import { error, stepInfo } from "./_output.ts";
import { runBuild } from "./build.ts";
import {
  type AgentEntry,
  DEFAULT_SERVER,
  ensureClaudeMd,
  ensureTypescriptSetup,
  getApiKey,
  getNamespace,
  resolveSlug,
  saveAgentLink,
} from "./_discover.ts";
import * as Comlink from "comlink";
import type { ExposedWorkerApi } from "@aai/core/worker-entry";
import { createWebSocketEndpoint } from "@aai/core/ws-endpoint";
import { createDenoWorker } from "@aai/core/deno-worker";
import { createWorkerApi } from "@aai/core/worker-entry";

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
    workerApi: createWorkerApi(worker as unknown as import("comlink").Endpoint),
    terminate: () => worker.terminate(),
  };
}

/** Convert an HTTP(S) URL to its WebSocket equivalent. */
function toWsUrl(httpUrl: string): string {
  const u = new URL(httpUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString().replace(/\/$/, "");
}

export const devCommand: Command = new Command()
  .description("Run local dev server with file watching")
  .option("-p, --port <port:number>", "Port for local proxy server", {
    default: 3000,
  })
  .option("-s, --server <url:string>", `Production server URL`, {
    default: DEFAULT_SERVER,
  })
  .option("--local [url:string]", "Use local server", { hidden: true })
  .action(async ({ port, server, local }) => {
    const cwd = Deno.env.get("INIT_CWD") || Deno.cwd();
    const serverUrl = local !== undefined
      ? (typeof local === "string" ? local : "http://localhost:3100")
      : server;

    const apiKey = await getApiKey();
    const namespace = await getNamespace();

    await ensureClaudeMd(cwd);
    await ensureTypescriptSetup(cwd);

    const result = await runBuild({ agentDir: cwd });

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
    let reg = await connectAndRegister(
      wsUrl,
      apiKey,
      namespace,
      result.agent,
      manifest,
      localWorker,
    );
    let devToken = reg.devToken;

    const proxyServer = startLocalProxy(
      port,
      fullPath,
      manifest.config?.name ?? slug,
      serverUrl,
      () => clientCode,
      () => devToken,
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

        reg.ws.close();
        reg = await connectAndRegister(
          wsUrl,
          apiKey,
          namespace,
          freshResult.agent,
          manifest,
          localWorker,
        );
        devToken = reg.devToken;

        printReady(freshResult.agent, namespace, port);
      } catch (err: unknown) {
        error(err instanceof Error ? err.message : String(err));
        stepInfo(
          "Dev",
          "still serving previous version — fix errors and save again",
        );
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
      try {
        watcher.close();
      } catch { /* already closed */ }
      localWorker.terminate();
      try {
        reg.ws.close();
      } catch { /* already closed */ }
      proxyServer.shutdown();
      Deno.exit(0);
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
  }) as unknown as Command;

/** Bidirectional WebSocket proxy — flat listeners, no nesting. */
function pipeWebSockets(clientWs: WebSocket, serverWs: WebSocket): void {
  clientWs.addEventListener("message", (e) => {
    if (serverWs.readyState === WebSocket.OPEN) serverWs.send(e.data);
  });
  serverWs.addEventListener("message", (e) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(e.data);
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
}

/** Wait for the next protocol message from a WebSocket. */
function nextWsMessage(
  ws: WebSocket,
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    ws.addEventListener("message", function onMsg(event) {
      if (typeof event.data !== "string") return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      ws.removeEventListener("message", onMsg);
      resolve(msg);
    });
    ws.addEventListener("close", () => resolve(null), { once: true });
    ws.addEventListener("error", () => resolve(null), { once: true });
  });
}

async function connectAndRegister(
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
  localWorker: ReturnType<typeof spawnLocalWorker>,
): Promise<{ ws: WebSocket; devToken: string }> {
  const fullPath = `${namespace}/${agent.slug}`;
  const url = `${wsUrl}/${fullPath}/dev`;
  const ws = new WebSocket(url);

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", (event) => {
      const msg = event instanceof ErrorEvent
        ? event.message
        : "WebSocket error";
      reject(new Error(`Failed to connect to server: ${msg}`));
    }, { once: true });
  });

  ws.addEventListener("close", (event) => {
    if (!event.wasClean) {
      error(`Control WebSocket closed: ${event.reason || "connection lost"}`);
    }
  });

  // Authenticate and register in a single message
  ws.send(JSON.stringify({
    type: "dev_register",
    token: apiKey,
    config: manifest.config ?? {
      instructions: "",
      greeting: "",
      voice: "luna",
    },
    toolSchemas: manifest.toolSchemas ?? [],
    env: agent.env,
    transport: agent.transport,
  }));
  const regMsg = await nextWsMessage(ws);
  if (!regMsg || regMsg.type === "dev_error") {
    throw new Error(
      (regMsg?.message as string) ?? "Server rejected registration",
    );
  }
  if (regMsg.type !== "dev_registered") {
    throw new Error(`Unexpected message: ${regMsg.type}`);
  }

  // Phase 3: Expose worker API via Comlink over WebSocket
  const endpoint = createWebSocketEndpoint(ws);
  const devApi: ExposedWorkerApi = {
    init() {},
    dispose() {},
    executeTool(name, args, sessionId, env) {
      return localWorker.workerApi.executeTool(
        name,
        args,
        sessionId,
        30_000,
        env,
      );
    },
    invokeHook(hook, sessionId, text, error, env) {
      return localWorker.workerApi.invokeHook(
        hook,
        sessionId,
        { text, error },
        5_000,
        env,
      );
    },
  };
  Comlink.expose(devApi, endpoint);

  const devToken = regMsg.devToken as string;
  if (!devToken) {
    throw new Error("Server did not return a dev token");
  }

  return { ws, devToken };
}

function startLocalProxy(
  port: number,
  fullPath: string,
  agentName: string,
  serverUrl: string,
  getClientCode: () => string,
  getDevToken: () => string,
): Deno.HttpServer {
  const wsUrl = toWsUrl(serverUrl);

  return Deno.serve(
    { port, hostname: "0.0.0.0", onListen: () => {} },
    async (req: Request) => {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path === `/${fullPath}` || path === `/${fullPath}/`) {
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
        const params = new URLSearchParams(url.search);
        params.set("token", getDevToken());
        const targetUrl = `${wsUrl}/${fullPath}/dev/websocket?${params}`;
        const serverWs = new WebSocket(targetUrl);
        serverWs.binaryType = "arraybuffer";

        pipeWebSockets(clientWs, serverWs);

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
  const url = `http://localhost:${port}/${fullPath}`;
  console.log(`\n  ${green(bold(url))}\n`);
  stepInfo("Watch", "for changes...");
}
