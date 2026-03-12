import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { renderAgentPage } from "./html.ts";
import { createSessionWSEvents } from "./ws_handler.ts";
import { createSession } from "./session.ts";
import { type AgentSlot, prepareSession, registerSlot } from "./worker_pool.ts";
import type { HonoEnv } from "./hono_env.ts";
import type { BundleStore } from "./bundle_store_tigris.ts";
import { upgradeWebSocket } from "hono/deno";

export const _internals = { prepareSession };

export async function discoverSlot(
  slug: string,
  slots: Map<string, AgentSlot>,
  store: BundleStore,
): Promise<AgentSlot | null> {
  const existing = slots.get(slug);
  if (existing) return existing;

  const manifest = await store.getManifest(slug);
  if (!manifest) return null;

  if (registerSlot(slots, manifest)) {
    console.info("Lazy-discovered agent from store", { slug });
  }
  return slots.get(slug) ?? null;
}

export async function resolveSlot(
  slug: string,
  slots: Map<string, AgentSlot>,
  store: BundleStore,
): Promise<AgentSlot | null> {
  const slot = await discoverSlot(slug, slots, store);
  if (!slot?.transport.includes("websocket")) return null;
  return slot;
}

async function requireSlot(
  slug: string,
  slots: Map<string, AgentSlot>,
  store: BundleStore,
): Promise<AgentSlot> {
  const slot = await resolveSlot(slug, slots, store);
  if (!slot) throw new HTTPException(404, { message: `Not found: ${slug}` });
  return slot;
}

export async function handleAgentHealth(c: Context<HonoEnv>) {
  const { slug, slots, store } = c.var;
  const slot = await requireSlot(slug, slots, store);
  return c.json({ status: "ok", slug, name: slot.name ?? slug });
}

export async function handleAgentPage(c: Context<HonoEnv>) {
  const { slug, slots, store } = c.var;
  const slot = await requireSlot(slug, slots, store);
  return c.html(renderAgentPage(slot.name ?? slug, `/${slug}`));
}

export const handleWebSocket = upgradeWebSocket(async (c) => {
  const { slug, slots, store, kvStore, sessions } = c.var;
  const slot = await requireSlot(slug, slots, store);

  const setup = await _internals.prepareSession(slot, slug, store, kvStore);
  const resume = c.req.query("resume") !== undefined;

  return createSessionWSEvents(sessions, {
    createSession: (sessionId, transport) =>
      createSession({
        id: sessionId,
        agent: slug,
        transport,
        ...setup,
        skipGreeting: resume,
      }),
    logContext: { slug },
  });
});

export async function handleStaticFile(c: Context<HonoEnv>) {
  const { slug, slots, store } = c.var;
  await requireSlot(slug, slots, store);

  const STATIC_FILES: Record<
    string,
    { key: "client" | "client_map"; ct: string }
  > = {
    "client.js": { key: "client", ct: "application/javascript" },
    "client.js.map": { key: "client_map", ct: "application/json" },
  };

  const file = c.req.path.split("/").pop() ?? "";
  const spec = STATIC_FILES[file];
  if (!spec) throw new HTTPException(404, { message: "Not found" });

  const content = await store.getFile(slug, spec.key);
  if (!content) throw new HTTPException(404, { message: "Not found" });
  return c.body(content, {
    headers: {
      "Content-Type": spec.ct,
      "Cache-Control": "no-cache",
    },
  });
}
