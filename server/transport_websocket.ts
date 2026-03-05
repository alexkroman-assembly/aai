import { Hono } from "@hono/hono";
import { loadPlatformConfig } from "./config.ts";
import { getLogger } from "./logger.ts";
import { renderAgentPage } from "./html.ts";
import { handleSessionWebSocket } from "./ws_handler.ts";
import { createSession, type Session } from "./session.ts";
import {
  type AgentSlot,
  createRpcToolExecutor,
  ensureAgent,
  registerSlot,
  trackSessionClose,
  trackSessionOpen,
} from "./worker_pool.ts";
import type { BundleStore } from "./bundle_store_tigris.ts";

const log = getLogger("websocket");

async function discoverSlot(
  slug: string,
  slots: Map<string, AgentSlot>,
  store: BundleStore,
): Promise<AgentSlot | null> {
  const existing = slots.get(slug);
  if (existing) return existing;

  const manifest = await store.getManifest(slug);
  if (!manifest) return null;

  if (registerSlot(slots, manifest)) {
    log.info("Lazy-discovered agent from store", { slug });
  }
  return slots.get(slug) ?? null;
}

export function createWebSocketRoutes(ctx: {
  slots: Map<string, AgentSlot>;
  sessions: Map<string, Session>;
  store: BundleStore;
}): Hono {
  const { slots, sessions, store } = ctx;
  const app = new Hono();

  // Resolve slot or 404 — used by every route; only serve websocket-enabled agents
  async function resolveSlot(slug: string): Promise<AgentSlot | null> {
    const slot = await discoverSlot(slug, slots, store);
    if (!slot?.transport.includes("websocket")) return null;
    return slot;
  }

  app.get("/:slug/health", async (c) => {
    const slug = c.req.param("slug");
    const slot = await resolveSlot(slug);
    if (!slot) return c.json({ error: "Not found", slug }, 404);
    try {
      const info = await ensureAgent(slot, (s) => store.getFile(s, "worker"));
      return c.json({ status: "ok", slug, name: info.name });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ status: "error", slug, error: msg }, 500);
    }
  });

  app.get("/:slug/", async (c) => {
    const slug = c.req.param("slug");
    const slot = await resolveSlot(slug);
    if (!slot) return c.json({ error: "Not found" }, 404);

    let info;
    try {
      info = await ensureAgent(slot, (s) => store.getFile(s, "worker"));
    } catch (err: unknown) {
      log.error("Failed to initialize agent", { slug, err });
      return c.json({ error: "Agent failed to initialize" }, 500);
    }
    return c.html(renderAgentPage(info.name, `/${slug}`));
  });

  app.get("/:slug", async (c) => {
    const slug = c.req.param("slug");
    const slot = await resolveSlot(slug);
    if (!slot) return c.json({ error: "Not found" }, 404);
    return c.redirect(`/${slug}/`, 301);
  });

  app.get("/:slug/websocket", async (c) => {
    const slug = c.req.param("slug");
    const slot = await resolveSlot(slug);
    if (!slot) return c.json({ error: "Not found" }, 404);
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      return c.json({ error: "Expected WebSocket upgrade" }, 400);
    }

    let info;
    try {
      info = await ensureAgent(slot);
    } catch (err: unknown) {
      log.error("Failed to initialize agent for session", { slug, err });
      return c.json({ error: "Agent failed to initialize" }, 500);
    }

    const resume = new URL(c.req.raw.url).searchParams.has("resume");
    const { socket, response } = Deno.upgradeWebSocket(c.req.raw);
    handleSessionWebSocket(socket, sessions, {
      createSession: (sessionId, ws) =>
        createSession({
          id: sessionId,
          transport: ws,
          agentConfig: info.config,
          toolSchemas: info.toolSchemas,
          platformConfig: loadPlatformConfig(slot.env),
          executeTool: createRpcToolExecutor(info.workerApi),
          secrets: slot.env,
          skipGreeting: resume,
        }),
      logContext: { slug: info.slug },
      onOpen: () => trackSessionOpen(slot),
      onClose: () => trackSessionClose(slot),
    });
    return response;
  });

  const STATIC_FILES: Record<
    string,
    { key: "client" | "client_map"; ct: string }
  > = {
    "client.js": { key: "client", ct: "application/javascript" },
    "client.js.map": { key: "client_map", ct: "application/json" },
  };

  for (const [file, { key, ct }] of Object.entries(STATIC_FILES)) {
    app.get(`/:slug/${file}`, async (c) => {
      const slug = c.req.param("slug");
      const slot = await resolveSlot(slug);
      if (!slot) return c.json({ error: "Not found" }, 404);
      const content = await store.getFile(slug, key);
      if (!content) return c.json({ error: "Not found" }, 404);
      return new Response(content, {
        headers: { "Content-Type": ct, "Cache-Control": "no-cache" },
      });
    });
  }

  return app;
}
