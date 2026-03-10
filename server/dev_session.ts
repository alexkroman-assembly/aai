import { type DevRegister, DevRegisterSchema } from "@aai/core/protocol";
import { createWebSocketTarget } from "@aai/core/rpc";
import { createWorkerApi } from "@aai/core/worker-entry";
import type { AgentConfig, ToolSchema } from "@aai/sdk/types";
import { getBuiltinToolSchemas } from "./builtin_tools.ts";
import type { AgentSlot } from "./worker_pool.ts";
import type { ServerContext } from "./types.ts";
import { getServerBaseUrl, hashApiKey } from "./deploy.ts";

export const _internals = {
  upgradeWebSocket: (req: Request) => Deno.upgradeWebSocket(req),
};

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

  const apiKey = new URL(req.url).searchParams.get("token");
  if (!apiKey) {
    return Response.json({ error: "Missing token parameter" }, { status: 401 });
  }

  const { socket, response } = _internals.upgradeWebSocket(req);

  socket.addEventListener("open", () => {
    console.info("Dev control WebSocket connected", { slug });
  });

  socket.addEventListener("message", async function onRegister(event) {
    if (typeof event.data !== "string") return;

    let json: unknown;
    try {
      json = JSON.parse(event.data);
    } catch {
      return;
    }

    if (typeof (json as Record<string, unknown>).id === "number") return;

    const parsed = DevRegisterSchema.safeParse(json);
    if (!parsed.success) {
      socket.send(JSON.stringify({
        type: "dev_error",
        message: `Invalid registration: ${parsed.error.message}`,
      }));
      return;
    }

    socket.removeEventListener("message", onRegister);

    const ownerHash = await hashApiKey(apiKey);
    const baseUrl = getServerBaseUrl(req);
    await registerDevAgent(
      socket,
      slug,
      parsed.data,
      ownerHash,
      baseUrl,
      ctx,
    );
  });

  socket.addEventListener("close", () => {
    console.info("Dev control WebSocket disconnected", { slug });
    const slot = ctx.slots.get(slug);
    if (slot?._dev) {
      ctx.slots.delete(slug);
      console.info("Removed dev slot", { slug });
    }
  });

  socket.addEventListener("error", (event) => {
    const msg = event instanceof ErrorEvent ? event.message : "WebSocket error";
    console.error("Dev control WebSocket error", { slug, error: msg });
  });

  return response;
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

  const existing = ctx.slots.get(slug);
  if (existing?.worker) {
    existing.worker.handle.terminate();
  }

  const kvToken = await ctx.tokenSigner.sign({ ownerHash, slug });
  const envWithKv = {
    ...msg.env,
    AAI_KV_URL: `${baseUrl}/kv`,
    AAI_SCOPE_TOKEN: kvToken,
  };

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
  };
  ctx.slots.set(slug, slot);

  await ctx.store.putAgent({
    slug,
    env: envWithKv,
    transport: msg.transport,
    worker: "", // no worker needed — tools run on CLI
    client: msg.client,
    owner_hash: ownerHash,
  });

  console.info("Dev agent registered", {
    slug,
    name: slot.name,
    tools: allToolSchemas.map((t) => t.name),
  });

  ws.send(JSON.stringify({ type: "dev_registered", slug }));
}
