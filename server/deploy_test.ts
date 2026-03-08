import { expect } from "@std/expect";
import { handleDeploy, hashApiKey } from "./deploy.ts";
import type { AgentSlot } from "./worker_pool.ts";
import { createTestStore, VALID_ENV } from "./_test_utils.ts";

function setup() {
  const store = createTestStore();
  const slots = new Map<string, AgentSlot>();
  return { store, slots };
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
      }),
    }),
    params: { namespace: parts[0], slug: parts[1] },
  };
}

Deno.test("deploy rejects missing Authorization header", async () => {
  const { slots, store } = setup();
  const { req, params } = deployReq("/ns/my-agent/deploy");
  const res = await handleDeploy(req, params, { slots, store });
  expect(res.status).toBe(400);
});

Deno.test("new deploy succeeds and stores owner_hash", async () => {
  const { slots, store } = setup();
  const { req, params } = deployReq("/ns/my-agent/deploy", "key1");
  const res = await handleDeploy(req, params, { slots, store });
  expect(res.status).toBe(200);
  const manifest = await store.getManifest("ns/my-agent");
  expect(manifest!.owner_hash).toBe(await hashApiKey("key1"));
});

Deno.test("same key can redeploy", async () => {
  const { slots, store } = setup();
  const d1 = deployReq("/ns/my-agent/deploy", "key1");
  await handleDeploy(d1.req, d1.params, { slots, store });
  const d2 = deployReq("/ns/my-agent/deploy", "key1");
  const res = await handleDeploy(d2.req, d2.params, { slots, store });
  expect(res.status).toBe(200);
});

Deno.test("different key is rejected for namespace owned by another", async () => {
  const { slots, store } = setup();
  const d1 = deployReq("/ns/my-agent/deploy", "key1");
  await handleDeploy(d1.req, d1.params, { slots, store });
  const d2 = deployReq("/ns/other-agent/deploy", "key2");
  const res = await handleDeploy(d2.req, d2.params, { slots, store });
  expect(res.status).toBe(403);
});

Deno.test("different namespaces with different keys both succeed", async () => {
  const { slots, store } = setup();
  const d1 = deployReq("/ns-a/agent/deploy", "key1");
  const res1 = await handleDeploy(d1.req, d1.params, { slots, store });
  const d2 = deployReq("/ns-b/agent/deploy", "key2");
  const res2 = await handleDeploy(d2.req, d2.params, { slots, store });
  expect(res1.status).toBe(200);
  expect(res2.status).toBe(200);
});

Deno.test("hashApiKey produces consistent hex output", async () => {
  const hash1 = await hashApiKey("test-key");
  const hash2 = await hashApiKey("test-key");
  expect(hash1).toBe(hash2);
  expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  expect(await hashApiKey("other-key")).not.toBe(hash1);
});
