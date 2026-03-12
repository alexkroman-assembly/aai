import type { Context } from "hono";
import { loadPlatformConfig } from "./config.ts";
import type { DeployBody } from "@aai/sdk/schema";
import { normalizeTransport } from "@aai/sdk/schema";
import { DeployBodySchema } from "./_schemas.ts";
import type { AgentSlot } from "./worker_pool.ts";
import type { HonoEnv } from "./hono_env.ts";
import { jsonValidator } from "./_validation.ts";

export { hashApiKey } from "./auth.ts";

export const validateDeployBody = jsonValidator(
  DeployBodySchema,
  "Invalid deploy body",
);

export async function handleDeploy(
  c: Context<HonoEnv, string, { out: { json: DeployBody } }>,
) {
  const { slug, accountId, slots, store } = c.var;
  const body = c.req.valid("json");

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
    account_id: accountId,
  });

  const slot: AgentSlot = {
    slug,
    env: body.env,
    transport,
    accountId,
  };
  slots.set(slug, slot);

  console.info("Deploy received", { slug, transport });

  return c.json({ ok: true, message: `Deployed ${slug}` });
}
