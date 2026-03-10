import {
  DevAuthSchema,
  type DevRegister,
  DevRegisterSchema,
} from "@aai/core/protocol";
import { createWebSocketTarget } from "@aai/core/rpc";
import { createWorkerApi } from "@aai/core/worker-entry";
import type { AgentConfig, ToolSchema } from "@aai/sdk/types";
import { getBuiltinToolSchemas } from "./builtin_tools.ts";
import {
  type AgentSlot,
  createToolExecutor,
  trackSessionClose,
  trackSessionOpen,
} from "./worker_pool.ts";
import type { ServerContext } from "./types.ts";
import { getServerBaseUrl } from "./deploy.ts";
import { claimNamespace, verifyOwner } from "./auth.ts";
import { loadPlatformConfig } from "./config.ts";
import { createSession, type Session } from "./session.ts";
import { signScopeToken } from "./scope_token.ts";
import { handleSessionWebSocket } from "./ws_handler.ts";
import type { ZodType } from "zod";

export const _internals = {
  upgradeWebSocket: (req: Request) => Deno.upgradeWebSocket(req),
};

/** Yield parsed protocol messages from a WebSocket, skipping RPC and binary. */
function protocolMessages(socket: WebSocket): ReadableStream<unknown> {
  let closed = false;
  return new ReadableStream({
    start(controller) {
      socket.addEventListener("message", (event) => {
        if (closed) return;
        if (typeof event.data !== "string") return;
        if (event.data.length > 1_000_000) return;
        let json: unknown;
        try {
          json = JSON.parse(event.data);
        } catch {
          return;
        }
        // Skip RPC messages
        if (typeof (json as Record<string, unknown>).id === "number") return;
        controller.enqueue(json);
      });
      socket.addEventListener("close", () => {
        if (closed) return;
        closed = true;
        controller.close();
      });
    },
  });
}

/** Read the next message from the stream and parse it with a Zod schema. */
async function nextMessage<T>(
  reader: ReadableStreamDefaultReader<unknown>,
  schema: ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const { value, done } = await reader.read();
  if (done) return { ok: false, error: "Connection closed" };
  const parsed = schema.safeParse(value);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  return { ok: true, data: parsed.data };
}

function sendError(socket: WebSocket, message: string) {
  socket.send(JSON.stringify({ type: "dev_error", message }));
}

export function handleDevWebSocket(
  req: Request,
  slug: string,
  ctx: ServerContext,
): Response {
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return Response.json({ error: "Expected WebSocket upgrade" }, {
      status: 400,
    });
  }

  const { socket, response } = _internals.upgradeWebSocket(req);

  socket.addEventListener("open", () => {
    console.info("Dev control WebSocket connected", { slug });
  });

  socket.addEventListener("close", () => {
    console.info("Dev control WebSocket disconnected", { slug });
    ctx.devSlots.delete(slug);
    console.info("Removed dev slot", { slug });
  });

  socket.addEventListener("error", (event) => {
    const msg = event instanceof ErrorEvent ? event.message : "WebSocket error";
    console.error("Dev control WebSocket error", { slug, error: msg });
  });

  runDevSession(socket, slug, req, ctx);

  return response;
}

async function runDevSession(
  socket: WebSocket,
  slug: string,
  req: Request,
  ctx: ServerContext,
): Promise<void> {
  const reader = protocolMessages(socket).getReader();

  // Phase 1: Authenticate
  const auth = await nextMessage(reader, DevAuthSchema);
  if (!auth.ok) {
    sendError(socket, "First message must be dev_auth with a token");
    socket.close();
    return;
  }

  const namespace = slug.split("/")[0];
  const ownerHash = await verifyOwner(auth.data.token, namespace, ctx.store);
  if (!ownerHash) {
    sendError(socket, `Namespace "${namespace}" is owned by another user.`);
    socket.close();
    return;
  }

  await claimNamespace(namespace, ownerHash, ctx.store);
  socket.send(JSON.stringify({ type: "dev_authenticated" }));

  // Phase 2: Register
  const reg = await nextMessage(reader, DevRegisterSchema);
  if (!reg.ok) {
    sendError(socket, `Invalid registration: ${reg.error}`);
    socket.close();
    return;
  }

  const baseUrl = getServerBaseUrl(req);
  await registerDevAgent(socket, slug, reg.data, ownerHash, baseUrl, ctx);
}

export async function registerDevAgent(
  ws: WebSocket,
  slug: string,
  msg: DevRegister,
  ownerHash: string,
  baseUrl: string,
  ctx: ServerContext,
): Promise<void> {
  const workerApi = createWorkerApi(createWebSocketTarget(ws));

  const agentConfig: AgentConfig = {
    name: msg.config.name,
    instructions: msg.config.instructions,
    greeting: msg.config.greeting,
    voice: msg.config.voice,
    prompt: msg.config.prompt,
    builtinTools: msg.config.builtinTools,
  };

  const customToolSchemas = msg.toolSchemas;
  const allToolSchemas: ToolSchema[] = [
    ...customToolSchemas,
    ...getBuiltinToolSchemas(agentConfig.builtinTools ?? []),
  ];

  const existing = ctx.devSlots.get(slug);
  if (existing?.worker) {
    existing.worker.handle.terminate();
  }

  const kvToken = await signScopeToken(ctx.scopeKey, { ownerHash, slug });
  const envWithKv = {
    ...msg.env,
    AAI_KV_URL: `${baseUrl}/kv`,
    AAI_SCOPE_TOKEN: kvToken,
  };

  const devToken = crypto.randomUUID();

  const slot: AgentSlot = {
    slug,
    env: envWithKv,
    transport: msg.transport,
    config: agentConfig,
    name: agentConfig.name ?? slug,
    toolSchemas: customToolSchemas,
    activeSessions: existing?.activeSessions ?? 0,
    worker: {
      handle: { terminate() {} },
      api: workerApi,
    },
    _dev: true,
    _devToken: devToken,
  };
  ctx.devSlots.set(slug, slot);

  console.info("Dev agent registered", {
    slug,
    name: slot.name,
    tools: allToolSchemas.map((t) => t.name),
  });

  ws.send(JSON.stringify({ type: "dev_registered", slug, devToken }));
}

export function handleDevSessionWebSocket(
  req: Request,
  slug: string,
  ctx: ServerContext,
): Response {
  const slot = ctx.devSlots.get(slug);
  if (!slot) {
    return Response.json({ error: "No dev session for this agent" }, {
      status: 404,
    });
  }

  const token = new URL(req.url).searchParams.get("token");
  if (!token || token !== slot._devToken) {
    return Response.json({ error: "Invalid dev token" }, { status: 403 });
  }

  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return Response.json({ error: "Expected WebSocket upgrade" }, {
      status: 400,
    });
  }

  const config = slot.config!;
  const builtinTools = getBuiltinToolSchemas(config.builtinTools ?? []);
  const toolSchemas = [...(slot.toolSchemas ?? []), ...builtinTools];
  const { executeTool, getWorkerApi } = createToolExecutor(slot, ctx.store);

  const resume = new URL(req.url).searchParams.has("resume");
  const { socket, response } = _internals.upgradeWebSocket(req);
  handleSessionWebSocket(socket, ctx.sessions as Map<string, Session>, {
    createSession: (sessionId, ws) =>
      createSession({
        id: sessionId,
        transport: ws,
        agentConfig: config,
        toolSchemas,
        platformConfig: loadPlatformConfig(slot.env),
        executeTool,
        getWorkerApi,
        env: slot.env,
        skipGreeting: resume,
      }),
    logContext: { slug, dev: "true" },
    onOpen: () => trackSessionOpen(slot),
    onClose: () => trackSessionClose(slot),
  });
  return response;
}
