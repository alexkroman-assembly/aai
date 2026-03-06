import { expect } from "@std/expect";
import { handleDeploy, hashApiKey } from "./deploy.ts";
import type { AgentSlot } from "./worker_pool.ts";
import { createTestStore, VALID_ENV } from "./_test_utils.ts";

function setup() {
  const store = createTestStore();
  const slots = new Map<string, AgentSlot>();
  return { store, slots };
}

function deployRequest(slug: string, apiKey?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  return new Request("http://localhost/deploy", {
    method: "POST",
    headers,
    body: JSON.stringify({
      slug,
      env: VALID_ENV,
      worker: "console.log('w');",
      client: "console.log('c');",
    }),
  });
}

Deno.test("deploy ownership", async (t) => {
  await t.step("rejects missing Authorization header", async () => {
    const { store, slots } = setup();
    const res = await handleDeploy(deployRequest("my-agent"), { slots, store });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("Missing Authorization header");
  });

  await t.step("new slug succeeds and stores owner_hash", async () => {
    const { store, slots } = setup();
    const res = await handleDeploy(deployRequest("my-agent", "key1"), {
      slots,
      store,
    });
    expect(res.status).toBe(200);

    const manifest = await store.getManifest("my-agent");
    expect(manifest).not.toBeNull();
    expect(manifest!.owner_hash).toBe(await hashApiKey("key1"));
  });

  await t.step("same key can redeploy to same slug", async () => {
    const { store, slots } = setup();
    const res1 = await handleDeploy(deployRequest("my-agent", "key1"), {
      slots,
      store,
    });
    expect(res1.status).toBe(200);

    const res2 = await handleDeploy(deployRequest("my-agent", "key1"), {
      slots,
      store,
    });
    expect(res2.status).toBe(200);
  });

  await t.step("different key is rejected for existing slug", async () => {
    const { store, slots } = setup();
    const res1 = await handleDeploy(deployRequest("my-agent", "key1"), {
      slots,
      store,
    });
    expect(res1.status).toBe(200);

    const res2 = await handleDeploy(deployRequest("my-agent", "key2"), {
      slots,
      store,
    });
    expect(res2.status).toBe(403);
    const text = await res2.text();
    expect(text).toContain("Slug already taken");
  });

  await t.step("different slugs with different keys both succeed", async () => {
    const { store, slots } = setup();
    const res1 = await handleDeploy(deployRequest("agent-a", "key1"), {
      slots,
      store,
    });
    expect(res1.status).toBe(200);

    const res2 = await handleDeploy(deployRequest("agent-b", "key2"), {
      slots,
      store,
    });
    expect(res2.status).toBe(200);
  });
});

Deno.test("hashApiKey produces consistent hex output", async () => {
  const hash1 = await hashApiKey("test-key");
  const hash2 = await hashApiKey("test-key");
  expect(hash1).toBe(hash2);
  expect(hash1).toMatch(/^[0-9a-f]{64}$/);

  const different = await hashApiKey("other-key");
  expect(different).not.toBe(hash1);
});
