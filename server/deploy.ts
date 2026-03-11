import type { Context } from "hono";
import { validator } from "hono/validator";
import { loadPlatformConfig } from "./config.ts";
import {
  type DeployBody,
  DeployBodySchema,
  normalizeTransport,
} from "@aai/sdk/schema";
import type { AgentSlot } from "./worker_pool.ts";
import type { HonoEnv } from "./hono_env.ts";

export { hashApiKey } from "./auth.ts";

export const validateDeployBody = validator("json", (value, c) => {
  const parsed = DeployBodySchema.safeParse(value);
  if (!parsed.success) {
    return c.json(
      { error: `Invalid deploy body: ${parsed.error.message}` },
      400,
    );
  }
  return parsed.data;
});

export async function handleDeploy(c: Context<HonoEnv>) {
  const { slug, ownerHash, slots, store } = c.var;
  const body = c.req.valid("json" as never) as DeployBody;

  try {
    loadPlatformConfig(body.env);
  } catch (err: unknown) {
    return c.json(
      {
        error: `Invalid platform config: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      400,
    );
  }

  const existing = slots.get(slug);
  if (existing?.worker) {
    console.info("Replacing existing deploy", { slug });
    existing.worker.handle.terminate();
    existing.worker = undefined;
    existing.initializing = undefined;
  }

  const transport = normalizeTransport(body.transport);

  await store.putAgent({
    slug,
    env: body.env,
    transport,
    worker: body.worker,
    client: body.client,
    owner_hash: ownerHash,
    config: body.config,
    toolSchemas: body.toolSchemas,
  });

  const slot: AgentSlot = {
    slug,
    env: body.env,
    transport,
    config: body.config,
    name: body.config?.name,
    toolSchemas: body.toolSchemas,
    ownerHash,
    activeSessions: 0,
  };
  slots.set(slug, slot);

  console.info("Deploy received", { slug, transport });

  return c.json({ ok: true, message: `Deployed ${slug}` });
}
