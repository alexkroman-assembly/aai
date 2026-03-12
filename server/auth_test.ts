import { expect } from "@std/expect";
import {
  claimNamespace,
  hashApiKey,
  verifyOrClaimNamespace,
  verifyOwner,
} from "./auth.ts";
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
  const result = await verifyOwner("key1", "ns", store);
  expect(result).not.toBeNull();
  expect(result).toBe(await hashApiKey("key1"));
  // Does not claim
  expect(await store.getNamespaceOwner("ns")).toBeNull();
});

Deno.test("verifyOwner allows same key for claimed namespace", async () => {
  const store = createTestStore();
  const hash = await hashApiKey("key1");
  await store.putNamespaceOwner("ns", {
    account_id: "acct-1",
    credential_hashes: [hash],
  });
  const result = await verifyOwner("key1", "ns", store);
  expect(result).toBe("acct-1");
});

Deno.test("verifyOwner rejects different key", async () => {
  const store = createTestStore();
  await store.putNamespaceOwner("ns", {
    account_id: "acct-1",
    credential_hashes: [await hashApiKey("key1")],
  });
  const result = await verifyOwner("key2", "ns", store);
  expect(result).toBeNull();
});

Deno.test("claimNamespace persists ownership", async () => {
  const store = createTestStore();
  const hash = await hashApiKey("key1");
  const owner = { account_id: "acct-1", credential_hashes: [hash] };
  await claimNamespace("ns", owner, store);
  expect(await store.getNamespaceOwner("ns")).toEqual(owner);
});

Deno.test("verifyOrClaimNamespace creates account for unclaimed namespace", async () => {
  const store = createTestStore();
  const accountId = await verifyOrClaimNamespace("key1", "ns", store);
  expect(accountId).toBeTruthy();
  // Namespace is now claimed
  const owner = await store.getNamespaceOwner("ns");
  expect(owner).not.toBeNull();
  expect(owner!.account_id).toBe(accountId);
  expect(owner!.credential_hashes).toContain(await hashApiKey("key1"));
});

Deno.test("verifyOrClaimNamespace returns accountId for existing owner", async () => {
  const store = createTestStore();
  const hash = await hashApiKey("key1");
  await store.putNamespaceOwner("ns", {
    account_id: "acct-1",
    credential_hashes: [hash],
  });
  const accountId = await verifyOrClaimNamespace("key1", "ns", store);
  expect(accountId).toBe("acct-1");
});

Deno.test("verifyOwner allows multiple credential hashes", async () => {
  const store = createTestStore();
  const hash1 = await hashApiKey("key1");
  const hash2 = await hashApiKey("key2");
  await store.putNamespaceOwner("ns", {
    account_id: "acct-1",
    credential_hashes: [hash1, hash2],
  });
  expect(await verifyOwner("key1", "ns", store)).toBe("acct-1");
  expect(await verifyOwner("key2", "ns", store)).toBe("acct-1");
  expect(await verifyOwner("key3", "ns", store)).toBeNull();
});
