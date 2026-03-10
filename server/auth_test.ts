import { expect } from "@std/expect";
import {
  claimNamespace,
  hashApiKey,
  requireOwner,
  verifyOwner,
} from "./auth.ts";
import { createTestStore, createTestScopeKey } from "./_test_utils.ts";
import type { ServerContext } from "./types.ts";

Deno.test("hashApiKey produces consistent 64-char hex", async () => {
  const h1 = await hashApiKey("key");
  const h2 = await hashApiKey("key");
  expect(h1).toBe(h2);
  expect(h1).toMatch(/^[0-9a-f]{64}$/);
  expect(await hashApiKey("other")).not.toBe(h1);
});

Deno.test("verifyOwner returns hash for unclaimed namespace", async () => {
  const store = createTestStore();
  const hash = await verifyOwner("key1", "ns", store);
  expect(hash).not.toBeNull();
  expect(hash).toBe(await hashApiKey("key1"));
  // Does not claim
  expect(await store.getNamespaceOwner("ns")).toBeNull();
});

Deno.test("verifyOwner allows same key for claimed namespace", async () => {
  const store = createTestStore();
  const hash = await hashApiKey("key1");
  await store.putNamespaceOwner("ns", hash);
  const result = await verifyOwner("key1", "ns", store);
  expect(result).toBe(hash);
});

Deno.test("verifyOwner rejects different key", async () => {
  const store = createTestStore();
  await store.putNamespaceOwner("ns", await hashApiKey("key1"));
  const hash = await verifyOwner("key2", "ns", store);
  expect(hash).toBeNull();
});

Deno.test("claimNamespace persists ownership", async () => {
  const store = createTestStore();
  const hash = await hashApiKey("key1");
  await claimNamespace("ns", hash, store);
  expect(await store.getNamespaceOwner("ns")).toBe(hash);
});

// --- requireOwner ---

async function makeCtx(): Promise<ServerContext> {
  return {
    slots: new Map(),
    devSlots: new Map(),
    sessions: new Map(),
    store: createTestStore(),
    scopeKey: await createTestScopeKey(),
  };
}

Deno.test("requireOwner returns 401 without Authorization header", async () => {
  const ctx = await makeCtx();
  const result = await requireOwner(new Request("http://x"), "ns/agent", ctx);
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).status).toBe(401);
});

Deno.test("requireOwner returns 403 for wrong owner", async () => {
  const ctx = await makeCtx();
  await ctx.store.putNamespaceOwner("ns", await hashApiKey("key1"));
  const req = new Request("http://x", {
    headers: { Authorization: "Bearer key2" },
  });
  const result = await requireOwner(req, "ns/agent", ctx);
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).status).toBe(403);
});

Deno.test("requireOwner returns ownerHash and claims namespace", async () => {
  const ctx = await makeCtx();
  const req = new Request("http://x", {
    headers: { Authorization: "Bearer mykey" },
  });
  const result = await requireOwner(req, "ns/agent", ctx);
  expect(typeof result).toBe("string");
  expect(result).toBe(await hashApiKey("mykey"));
  // Namespace was claimed
  expect(await ctx.store.getNamespaceOwner("ns")).toBe(result);
});
