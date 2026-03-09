import { z } from "zod";
import type { KvStore } from "./kv.ts";
import type { TokenSigner } from "./scope_token.ts";

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
]);

export async function handleKv(
  req: Request,
  ctx: { kvStore: KvStore; tokenSigner: TokenSigner },
): Promise<Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json(
      { error: "Missing Authorization header" },
      { status: 401 },
    );
  }

  const scope = await ctx.tokenSigner.verify(authHeader.slice(7));
  if (!scope) {
    return Response.json(
      { error: "Invalid or tampered scope token" },
      { status: 403 },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = KvRequestSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: `Invalid request: ${parsed.error.message}` },
      { status: 400 },
    );
  }

  const msg = parsed.data;

  try {
    switch (msg.op) {
      case "get": {
        const result = await ctx.kvStore.get(scope, msg.key);
        return Response.json({ result });
      }
      case "set": {
        await ctx.kvStore.set(scope, msg.key, msg.value, msg.ttl);
        return Response.json({ result: "OK" });
      }
      case "del": {
        await ctx.kvStore.del(scope, msg.key);
        return Response.json({ result: "OK" });
      }
      case "keys": {
        const result = await ctx.kvStore.keys(scope, msg.pattern);
        return Response.json({ result });
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("KV operation failed", {
      op: msg.op,
      slug: scope.slug,
      error: message,
    });
    return Response.json(
      { error: `KV operation failed: ${message}` },
      { status: 500 },
    );
  }
}
