import { Hono } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import { z } from "zod";
import { loadPlatformConfig } from "./config.ts";
import { getLogger } from "./logger.ts";
import type { AgentSlot } from "./worker_pool.ts";
import type { BundleStore } from "./bundle_store_tigris.ts";

export async function hashApiKey(apiKey: string): Promise<string> {
  const data = new TextEncoder().encode(apiKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const DeployBodySchema = z.object({
  slug: z.string().min(1),
  env: z.record(z.string(), z.string()),
  worker: z.string().min(1).optional(),
  worker_url: z.string().url().optional(),
  client: z.string().min(1),
  transport: z.union([
    z.enum(["websocket", "twilio"]),
    z.array(z.enum(["websocket", "twilio"])),
  ]).optional(),
}).refine((d) => d.worker || d.worker_url, {
  message: "Either worker or worker_url must be provided",
});

const log = getLogger("deploy");

export function createDeployRoute(ctx: {
  slots: Map<string, AgentSlot>;
  store: BundleStore;
}): Hono {
  const { slots, store } = ctx;
  const deploy = new Hono();

  deploy.post("/deploy", async (c) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new HTTPException(400, {
        message: "Missing Authorization header (Bearer <ASSEMBLYAI_API_KEY>)",
      });
    }
    const apiKey = authHeader.slice("Bearer ".length);
    const ownerHash = await hashApiKey(apiKey);

    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      throw new HTTPException(400, { message: "Invalid JSON body" });
    }

    const parsed = DeployBodySchema.safeParse(json);
    if (!parsed.success) {
      throw new HTTPException(400, {
        message: `Invalid deploy body: ${parsed.error.message}`,
      });
    }
    const body = parsed.data;

    // Skip platform config validation when using remote worker (dev mode)
    if (!body.worker_url) {
      try {
        loadPlatformConfig(body.env);
      } catch (err: unknown) {
        throw new HTTPException(400, {
          message: `Invalid platform config: ${(err as Error).message}`,
        });
      }
    }

    // Check slug ownership
    const existingManifest = await store.getManifest(body.slug);
    if (
      existingManifest?.owner_hash && existingManifest.owner_hash !== ownerHash
    ) {
      throw new HTTPException(403, {
        message:
          'Slug already taken by another owner. Change the "name" field in agent.json to use a different slug.',
      });
    }

    const existing = slots.get(body.slug);
    if (existing?.live) {
      log.info("Replacing existing deploy", { slug: body.slug });
      existing.live.worker.terminate();
      existing.live = undefined;
      existing.initializing = undefined;
    }

    const transport: ("websocket" | "twilio")[] = body.transport === undefined
      ? ["websocket"]
      : typeof body.transport === "string"
      ? [body.transport]
      : body.transport;

    await store.putAgent({
      slug: body.slug,
      env: body.env,
      transport,
      worker: body.worker ?? "",
      client: body.client,
      owner_hash: ownerHash,
    });

    const slot: AgentSlot = {
      slug: body.slug,
      env: body.env,
      transport,
      activeSessions: 0,
      workerUrl: body.worker_url,
    };
    slots.set(body.slug, slot);

    log.info("Deploy received", { slug: body.slug, transport });

    return c.json({ ok: true, message: `Deployed ${body.slug}` });
  });

  return deploy;
}
