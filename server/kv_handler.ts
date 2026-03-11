import type { Context } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";
import type { HonoEnv } from "./hono_env.ts";

const KvRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("get"), key: z.string() }),
  z.object({
    op: z.literal("set"),
    key: z.string(),
    value: z.string(),
    ttl: z.number().optional(),
  }),
  z.object({ op: z.literal("del"), key: z.string() }),
  z.object({ op: z.literal("keys"), pattern: z.string().optional() }),
  z.object({
    op: z.literal("list"),
    prefix: z.string(),
    limit: z.number().optional(),
    reverse: z.boolean().optional(),
  }),
]);

export const validateKvRequest = validator("json", (value, c) => {
  const parsed = KvRequestSchema.safeParse(value);
  if (!parsed.success) {
    return c.json(
      { error: `Invalid request: ${parsed.error.message}` },
      400,
    );
  }
  return parsed.data;
});

export async function handleKv(c: Context<HonoEnv>) {
  const { scope, kvStore } = c.var;
  const msg = c.req.valid("json" as never) as z.infer<typeof KvRequestSchema>;

  try {
    switch (msg.op) {
      case "get":
        return c.json({ result: await kvStore.get(scope, msg.key) });
      case "set":
        await kvStore.set(scope, msg.key, msg.value, msg.ttl);
        return c.json({ result: "OK" });
      case "del":
        await kvStore.del(scope, msg.key);
        return c.json({ result: "OK" });
      case "keys":
        return c.json({ result: await kvStore.keys(scope, msg.pattern) });
      case "list":
        return c.json({
          result: await kvStore.list(scope, msg.prefix, {
            limit: msg.limit,
            reverse: msg.reverse,
          }),
        });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("KV operation failed", {
      op: msg.op,
      slug: scope.slug,
      error: message,
    });
    return c.json({ error: `KV operation failed: ${message}` }, 500);
  }
}
