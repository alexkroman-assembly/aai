import { loadPlatformConfig } from "./config.ts";
import { DeployBodySchema, normalizeTransport } from "@aai/sdk/schema";
import type { AgentSlot } from "./worker_pool.ts";
import type { ServerContext } from "./types.ts";

export { hashApiKey } from "./auth.ts";

export function getServerBaseUrl(req: Request): string {
  const flyApp = Deno.env.get("FLY_APP_NAME");
  if (flyApp) return `https://${flyApp}.fly.dev`;
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

export async function handleDeploy(
  req: Request,
  compositeSlug: string,
  ownerHash: string,
  ctx: ServerContext,
): Promise<Response> {
  const { slots, store } = ctx;

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
      {
        error: `Invalid platform config: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 400 },
    );
  }

  const existing = slots.get(compositeSlug);
  if (existing?.worker) {
    console.info("Replacing existing deploy", { slug: compositeSlug });
    existing.worker.handle.terminate();
    existing.worker = undefined;
    existing.initializing = undefined;
  }

  const transport = normalizeTransport(body.transport);

  const baseUrl = getServerBaseUrl(req);
  const kvToken = await ctx.tokenSigner.sign({
    ownerHash,
    slug: compositeSlug,
  });
  const envWithKv = {
    ...body.env,
    AAI_KV_URL: `${baseUrl}/kv`,
    AAI_SCOPE_TOKEN: kvToken,
  };

  await store.putAgent({
    slug: compositeSlug,
    env: envWithKv,
    transport,
    worker: body.worker,
    client: body.client,
    owner_hash: ownerHash,
    config: body.config,
    toolSchemas: body.toolSchemas,
  });

  const slot: AgentSlot = {
    slug: compositeSlug,
    env: envWithKv,
    transport,
    config: body.config,
    name: body.config?.name,
    toolSchemas: body.toolSchemas,
    activeSessions: 0,
  };
  slots.set(compositeSlug, slot);

  console.info("Deploy received", { slug: compositeSlug, transport });

  return Response.json({
    ok: true,
    message: `Deployed ${compositeSlug}`,
  });
}
