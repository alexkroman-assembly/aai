import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { type DevRegister, DevRegisterSchema } from "@aai/core/protocol";
import { createWebSocketEndpoint } from "@aai/core/ws-endpoint";
import { createWorkerApi } from "@aai/core/worker-entry";
import type { AgentConfig, ToolSchema } from "@aai/sdk/types";
import { getBuiltinToolSchemas } from "./builtin_tools.ts";
import {
  type AgentSlot,
  trackSessionClose,
  trackSessionOpen,
} from "./worker_pool.ts";
import type { HonoEnv } from "./hono_env.ts";
import { claimNamespace, verifyOwner } from "./auth.ts";
import { signScopeToken, verifyScopeToken } from "./scope_token.ts";
import { createSession } from "./session.ts";
import { prepareSession } from "./session_setup.ts";
import { handleSessionWebSocket } from "./ws_handler.ts";
import type { BundleStore } from "./bundle_store_tigris.ts";
import type { ScopeKey } from "./scope_token.ts";

export const _internals = {
  upgradeWebSocket: (req: Request) => Deno.upgradeWebSocket(req),
};

/** Wait for the first JSON message on a WebSocket. */
function nextJsonMessage(socket: WebSocket): Promise<unknown | null> {
  return new Promise((resolve) => {
    socket.addEventListener("message", function onMsg(event) {
      if (typeof event.data !== "string") return;
      if (event.data.length > 1_000_000) return;
      try {
        socket.removeEventListener("message", onMsg);
        resolve(JSON.parse(event.data));
      } catch { /* ignore non-JSON */ }
    });
    socket.addEventListener("close", () => resolve(null), { once: true });
  });
}

function sendError(socket: WebSocket, message: string) {
  socket.send(JSON.stringify({ type: "dev_error", message }));
}

export function handleDevWebSocket(c: Context<HonoEnv>) {
  const { slug, slots: _slots, devSlots, store, scopeKey } = c.var;

  const { socket, response } = _internals.upgradeWebSocket(c.req.raw);

  socket.addEventListener("open", () => {
    console.info("Dev control WebSocket connected", { slug });
  });

  socket.addEventListener("close", () => {
    console.info("Dev control WebSocket disconnected", { slug });
    devSlots.delete(slug);
    console.info("Removed dev slot", { slug });
  });

  socket.addEventListener("error", (event) => {
    const msg = event instanceof ErrorEvent ? event.message : "WebSocket error";
    console.error("Dev control WebSocket error", { slug, error: msg });
  });

  runDevSession(socket, slug, devSlots, store, scopeKey);

  return response;
}

async function runDevSession(
  socket: WebSocket,
  slug: string,
  devSlots: Map<string, AgentSlot>,
  store: BundleStore,
  scopeKey: ScopeKey,
): Promise<void> {
  const msg = await nextJsonMessage(socket);
  if (!msg) return;

  const parsed = DevRegisterSchema.safeParse(msg);
  if (!parsed.success) {
    sendError(socket, "First message must be dev_register with a token");
    socket.close();
    return;
  }

  const namespace = slug.split("/")[0];
  const ownerHash = await verifyOwner(parsed.data.token, namespace, store);
  if (!ownerHash) {
    sendError(socket, `Namespace "${namespace}" is owned by another user.`);
    socket.close();
    return;
  }

  await claimNamespace(namespace, ownerHash, store);
  await registerDevAgent(
    socket,
    slug,
    parsed.data,
    ownerHash,
    devSlots,
    scopeKey,
  );
}

export async function registerDevAgent(
  ws: WebSocket,
  slug: string,
  msg: DevRegister,
  ownerHash: string,
  devSlots: Map<string, AgentSlot>,
  scopeKey: ScopeKey,
): Promise<void> {
  const workerApi = createWorkerApi(createWebSocketEndpoint(ws));

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

  const existing = devSlots.get(slug);
  if (existing?.worker) {
    existing.worker.handle.terminate();
  }

  const devToken = await signScopeToken(scopeKey, { ownerHash, slug });

  const slot: AgentSlot = {
    slug,
    env: msg.env,
    transport: msg.transport,
    config: agentConfig,
    name: agentConfig.name ?? slug,
    toolSchemas: customToolSchemas,
    ownerHash,
    activeSessions: existing?.activeSessions ?? 0,
    worker: {
      handle: { terminate() {} },
      api: workerApi,
    },
    _dev: true,
  };
  devSlots.set(slug, slot);

  console.info("Dev agent registered", {
    slug,
    name: slot.name,
    tools: allToolSchemas.map((t) => t.name),
  });

  ws.send(JSON.stringify({ type: "dev_registered", slug, devToken }));
}

export async function handleDevSessionWebSocket(c: Context<HonoEnv>) {
  const { slug, devSlots, store, kvStore, scopeKey, sessions } = c.var;
  const slot = devSlots.get(slug);
  if (!slot) {
    throw new HTTPException(404, { message: "No dev session for this agent" });
  }

  const token = c.req.query("token");
  if (!token) throw new HTTPException(401, { message: "Missing token" });

  const scope = await verifyScopeToken(scopeKey, token);
  if (!scope || scope.slug !== slug) {
    throw new HTTPException(403, { message: "Invalid dev token" });
  }

  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
    throw new HTTPException(400, { message: "Expected WebSocket upgrade" });
  }

  const setup = prepareSession(slot, slug, store, kvStore);

  const resume = c.req.query("resume") !== undefined;
  const { socket, response } = _internals.upgradeWebSocket(c.req.raw);
  handleSessionWebSocket(socket, sessions, {
    createSession: (sessionId, ws) =>
      createSession({
        id: sessionId,
        agent: slug,
        transport: ws,
        ...setup,
        skipGreeting: resume,
      }),
    logContext: { slug, dev: "true" },
    onOpen: () => trackSessionOpen(slot),
    onClose: () => trackSessionClose(slot),
  });
  return response;
}
