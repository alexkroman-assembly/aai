import { assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { handleDeploy, hashApiKey } from "./deploy.ts";
import type { AgentSlot } from "./worker_pool.ts";
import { createTestStore, VALID_ENV } from "./_test_utils.ts";
import { createTokenSigner } from "./scope_token.ts";

async function setup() {
  const store = createTestStore();
  const slots = new Map<string, AgentSlot>();
  const tokenSigner = await createTokenSigner("test-secret");
  return { store, slots, tokenSigner };
}

function deployReq(
  path: string,
  apiKey?: string,
): { req: Request; params: Record<string, string> } {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const parts = path.replace(/^\//, "").split("/");
  return {
    req: new Request(`http://localhost${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        env: VALID_ENV,
        worker: "console.log('w');",
        client: "console.log('c');",
        config: {
          instructions: "test",
          greeting: "hello",
          voice: "luna",
        },
      }),
    }),
    params: { namespace: parts[0], slug: parts[1] },
  };
}

Deno.test("deploy rejects missing Authorization header", async () => {
  const ctx = await setup();
  const { req, params } = deployReq("/ns/my-agent/deploy");
  const res = await handleDeploy(req, params, ctx);
  assertEquals(res.status, 400);
});

Deno.test("new deploy succeeds and stores owner_hash", async () => {
  const ctx = await setup();
  const { req, params } = deployReq("/ns/my-agent/deploy", "key1");
  const res = await handleDeploy(req, params, ctx);
  assertEquals(res.status, 200);
  const manifest = await ctx.store.getManifest("ns/my-agent");
  assertEquals(manifest!.owner_hash, await hashApiKey("key1"));
});

Deno.test("same key can redeploy", async () => {
  const ctx = await setup();
  const d1 = deployReq("/ns/my-agent/deploy", "key1");
  await handleDeploy(d1.req, d1.params, ctx);
  const d2 = deployReq("/ns/my-agent/deploy", "key1");
  const res = await handleDeploy(d2.req, d2.params, ctx);
  assertEquals(res.status, 200);
});

Deno.test("different key is rejected for namespace owned by another", async () => {
  const ctx = await setup();
  const d1 = deployReq("/ns/my-agent/deploy", "key1");
  await handleDeploy(d1.req, d1.params, ctx);
  const d2 = deployReq("/ns/other-agent/deploy", "key2");
  const res = await handleDeploy(d2.req, d2.params, ctx);
  assertEquals(res.status, 403);
});

Deno.test("different namespaces with different keys both succeed", async () => {
  const ctx = await setup();
  const d1 = deployReq("/ns-a/agent/deploy", "key1");
  const res1 = await handleDeploy(d1.req, d1.params, ctx);
  const d2 = deployReq("/ns-b/agent/deploy", "key2");
  const res2 = await handleDeploy(d2.req, d2.params, ctx);
  assertEquals(res1.status, 200);
  assertEquals(res2.status, 200);
});

Deno.test("deploy rejects missing config", async () => {
  const ctx = await setup();
  const req = new Request("http://localhost/ns/my-agent/deploy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer key1",
    },
    body: JSON.stringify({
      env: VALID_ENV,
      worker: "console.log('w');",
      client: "console.log('c');",
    }),
  });
  const res = await handleDeploy(
    req,
    { namespace: "ns", slug: "my-agent" },
    ctx,
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertMatch(body.error, /config/i);
});

Deno.test("hashApiKey produces consistent hex output", async () => {
  const hash1 = await hashApiKey("test-key");
  const hash2 = await hashApiKey("test-key");
  assertEquals(hash1, hash2);
  assertMatch(hash1, /^[0-9a-f]{64}$/);
  assertNotEquals(await hashApiKey("other-key"), hash1);
});
