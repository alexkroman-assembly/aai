import { expect } from "@std/expect";
import { claimNamespace, hashApiKey, verifyOwner } from "./auth.ts";
import { createTestStore } from "./_test_utils.ts";

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
