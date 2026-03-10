import { renderAgentPage } from "./html.ts";
import { handleSessionWebSocket } from "./ws_handler.ts";
import { createSession, type Session } from "./session.ts";
import {
  type AgentSlot,
  createToolExecutor,
  registerSlot,
  trackSessionClose,
  trackSessionOpen,
} from "./worker_pool.ts";
import { loadPlatformConfig } from "./config.ts";
import { getBuiltinToolSchemas } from "./builtin_tools.ts";
import type { ServerContext } from "./types.ts";

export const _internals = {
  upgradeWebSocket: (req: Request) => Deno.upgradeWebSocket(req),
};

export async function discoverSlot(
  slug: string,
  ctx: ServerContext,
): Promise<AgentSlot | null> {
  const existing = ctx.slots.get(slug);
  if (existing) return existing;

  const manifest = await ctx.store.getManifest(slug);
  if (!manifest) return null;

  if (registerSlot(ctx.slots, manifest)) {
    console.info("Lazy-discovered agent from store", { slug });
  }
  return ctx.slots.get(slug) ?? null;
}

export async function resolveSlot(
  slug: string,
  ctx: ServerContext,
): Promise<AgentSlot | null> {
  const slot = await discoverSlot(slug, ctx);
  if (!slot?.transport.includes("websocket")) return null;
  return slot;
}

export async function handleAgentHealth(
  _req: Request,
  slug: string,
  ctx: ServerContext,
): Promise<Response> {
  const slot = await resolveSlot(slug, ctx);
  if (!slot) {
    return Response.json({ error: "Not found", slug }, { status: 404 });
  }
  return Response.json({ status: "ok", slug, name: slot.name ?? slug });
}

export async function handleAgentPage(
  _req: Request,
  slug: string,
  ctx: ServerContext,
): Promise<Response> {
  const slot = await resolveSlot(slug, ctx);
  if (!slot) return Response.json({ error: "Not found" }, { status: 404 });
  const name = slot.name ?? slug;
  return new Response(renderAgentPage(name, `/${slug}`), {
    headers: { "Content-Type": "text/html; charset=UTF-8" },
  });
}

export async function handleAgentRedirect(
  _req: Request,
  slug: string,
  ctx: ServerContext,
): Promise<Response> {
  const slot = await resolveSlot(slug, ctx);
  if (!slot) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(null, {
    status: 301,
    headers: { Location: `/${slug}/` },
  });
}

export async function handleWebSocket(
  req: Request,
  slug: string,
  ctx: ServerContext,
): Promise<Response> {
  const slot = await resolveSlot(slug, ctx);
  if (!slot) return Response.json({ error: "Not found" }, { status: 404 });

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
    logContext: { slug },
    onOpen: () => trackSessionOpen(slot),
    onClose: () => trackSessionClose(slot),
  });
  return response;
}

export async function handleStaticFile(
  _req: Request,
  slug: string,
  file: string,
  ctx: ServerContext,
): Promise<Response> {
  const slot = await resolveSlot(slug, ctx);
  if (!slot) return Response.json({ error: "Not found" }, { status: 404 });

  const STATIC_FILES: Record<
    string,
    { key: "client" | "client_map"; ct: string }
  > = {
    "client.js": { key: "client", ct: "application/javascript" },
    "client.js.map": { key: "client_map", ct: "application/json" },
  };

  const spec = STATIC_FILES[file];
  if (!spec) return Response.json({ error: "Not found" }, { status: 404 });

  const content = await ctx.store.getFile(slug, spec.key);
  if (!content) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(content, {
    headers: { "Content-Type": spec.ct, "Cache-Control": "no-cache" },
  });
}
