import { loadPlatformConfig } from "./config.ts";
import { getLogger } from "./logger.ts";
import type { AgentSlot } from "./worker_pool.ts";
import type { BundleStore } from "./bundle_store_tigris.ts";
import { DeployBodySchema } from "../sdk/_schema.ts";

export async function hashApiKey(apiKey: string): Promise<string> {
  const data = new TextEncoder().encode(apiKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const log = getLogger("deploy");

export async function handleDeploy(
  req: Request,
  ctx: { slots: Map<string, AgentSlot>; store: BundleStore },
): Promise<Response> {
  const { slots, store } = ctx;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json(
      { error: "Missing Authorization header (Bearer <ASSEMBLYAI_API_KEY>)" },
      { status: 400 },
    );
  }
  const apiKey = authHeader.slice("Bearer ".length);
  const ownerHash = await hashApiKey(apiKey);

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = DeployBodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: `Invalid deploy body: ${parsed.error.message}` },
      { status: 400 },
    );
  }
  const body = parsed.data;

  try {
    loadPlatformConfig(body.env);
  } catch (err: unknown) {
    return Response.json(
      { error: `Invalid platform config: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  // Check slug ownership
  const existingManifest = await store.getManifest(body.slug);
  if (
    existingManifest?.owner_hash && existingManifest.owner_hash !== ownerHash
  ) {
    return Response.json(
      {
        error:
          'Slug already taken by another owner. Change the "name" field in agent.json to use a different slug.',
      },
      { status: 403 },
    );
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
    worker: body.worker,
    client: body.client,
    owner_hash: ownerHash,
  });

  const slot: AgentSlot = {
    slug: body.slug,
    env: body.env,
    transport,
    activeSessions: 0,
  };
  slots.set(body.slug, slot);

  log.info("Deploy received", { slug: body.slug, transport });

  return Response.json({ ok: true, message: `Deployed ${body.slug}` });
}
