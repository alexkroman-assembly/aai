import { assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { handleDeploy } from "./deploy.ts";
import { hashApiKey, requireOwner } from "./auth.ts";
import type { ServerContext } from "./types.ts";
import {
  createTestStore,
  createTestScopeKey,
  VALID_ENV,
} from "./_test_utils.ts";

async function setup(): Promise<ServerContext> {
  return {
    slots: new Map(),
    devSlots: new Map(),
    sessions: new Map(),
    store: createTestStore(),
    scopeKey: await createTestScopeKey(),
  };
}

function deployBody() {
  return JSON.stringify({
    env: VALID_ENV,
    worker: "console.log('w');",
    client: "console.log('c');",
    config: {
      instructions: "test",
      greeting: "hello",
      voice: "luna",
    },
  });
}

// --- requireOwner ---

Deno.test("requireOwner rejects missing Authorization header", async () => {
  const ctx = await setup();
  const req = new Request("http://localhost/ns/my-agent/deploy", {
    method: "POST",
    body: deployBody(),
  });
  const result = await requireOwner(req, "ns/my-agent", ctx);
  assertEquals((result as Response).status, 401);
});

Deno.test("requireOwner rejects different owner for claimed namespace", async () => {
  const ctx = await setup();
  await ctx.store.putNamespaceOwner("ns", await hashApiKey("key1"));

  const req = new Request("http://localhost/ns/my-agent/deploy", {
    method: "POST",
    headers: { Authorization: "Bearer key2" },
    body: deployBody(),
  });
  const result = await requireOwner(req, "ns/my-agent", ctx);
  assertEquals((result as Response).status, 403);
});

Deno.test("requireOwner returns ownerHash on success", async () => {
  const ctx = await setup();
  const req = new Request("http://localhost/ns/my-agent/deploy", {
    method: "POST",
    headers: { Authorization: "Bearer key1" },
    body: deployBody(),
  });
  const result = await requireOwner(req, "ns/my-agent", ctx);
  assertEquals(typeof result, "string");
  assertEquals(result, await hashApiKey("key1"));
});

// --- handleDeploy (auth already resolved) ---

Deno.test("handleDeploy succeeds and stores agent", async () => {
  const ctx = await setup();
  const ownerHash = await hashApiKey("key1");
  const req = new Request("http://localhost/ns/my-agent/deploy", {
    method: "POST",
    body: deployBody(),
  });
  const res = await handleDeploy(req, "ns/my-agent", ownerHash, ctx);
  assertEquals(res.status, 200);
  const manifest = await ctx.store.getManifest("ns/my-agent");
  assertEquals(manifest!.owner_hash, ownerHash);
});

Deno.test("handleDeploy can redeploy same slug", async () => {
  const ctx = await setup();
  const ownerHash = await hashApiKey("key1");

  const req1 = new Request("http://localhost/ns/my-agent/deploy", {
    method: "POST",
    body: deployBody(),
  });
  await handleDeploy(req1, "ns/my-agent", ownerHash, ctx);

  const req2 = new Request("http://localhost/ns/my-agent/deploy", {
    method: "POST",
    body: deployBody(),
  });
  const res = await handleDeploy(req2, "ns/my-agent", ownerHash, ctx);
  assertEquals(res.status, 200);
});

Deno.test("handleDeploy rejects missing config", async () => {
  const ctx = await setup();
  const ownerHash = await hashApiKey("key1");
  const req = new Request("http://localhost/ns/my-agent/deploy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      env: VALID_ENV,
      worker: "console.log('w');",
      client: "console.log('c');",
    }),
  });
  const res = await handleDeploy(req, "ns/my-agent", ownerHash, ctx);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertMatch(body.error, /config/i);
});

// --- hashApiKey ---

Deno.test("hashApiKey produces consistent hex output", async () => {
  const hash1 = await hashApiKey("test-key");
  const hash2 = await hashApiKey("test-key");
  assertEquals(hash1, hash2);
  assertMatch(hash1, /^[0-9a-f]{64}$/);
  assertNotEquals(await hashApiKey("other-key"), hash1);
});
