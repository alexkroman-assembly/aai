import { assertEquals } from "@std/assert";
import { handleKv } from "./kv_handler.ts";
import { createMemoryKvStore } from "./kv.ts";
import type { AgentScope } from "./scope_token.ts";
import { importScopeKey, signScopeToken } from "./scope_token.ts";

const scope: AgentScope = { ownerHash: "owner1", slug: "ns/agent-a" };

async function makeCtx() {
  return {
    kvStore: createMemoryKvStore(),
    scopeKey: await importScopeKey("test-secret"),
  };
}

function kvReq(token: string, body: Record<string, unknown>): Request {
  return new Request("http://localhost/kv", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

Deno.test("handleKv", async (t) => {
  await t.step("rejects missing auth", async () => {
    const ctx = await makeCtx();
    const req = new Request("http://localhost/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "get", key: "k" }),
    });
    assertEquals((await handleKv(req, ctx)).status, 401);
  });

  await t.step("rejects bad token", async () => {
    const ctx = await makeCtx();
    assertEquals(
      (await handleKv(kvReq("bad", { op: "get", key: "k" }), ctx)).status,
      403,
    );
  });

  await t.step("rejects bad JSON", async () => {
    const ctx = await makeCtx();
    const token = await signScopeToken(ctx.scopeKey, scope);
    const req = new Request("http://localhost/kv", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: "not json",
    });
    assertEquals((await handleKv(req, ctx)).status, 400);
  });

  await t.step("rejects invalid op", async () => {
    const ctx = await makeCtx();
    const token = await signScopeToken(ctx.scopeKey, scope);
    assertEquals(
      (await handleKv(kvReq(token, { op: "drop_table" }), ctx)).status,
      400,
    );
  });

  await t.step("set and get round-trip", async () => {
    const ctx = await makeCtx();
    const token = await signScopeToken(ctx.scopeKey, scope);

    const setRes = await handleKv(
      kvReq(token, { op: "set", key: "k1", value: "v1" }),
      ctx,
    );
    assertEquals(setRes.status, 200);
    assertEquals((await setRes.json()).result, "OK");

    const getRes = await handleKv(
      kvReq(token, { op: "get", key: "k1" }),
      ctx,
    );
    assertEquals((await getRes.json()).result, "v1");
  });

  await t.step("get returns null for missing key", async () => {
    const ctx = await makeCtx();
    const token = await signScopeToken(ctx.scopeKey, scope);
    const res = await handleKv(kvReq(token, { op: "get", key: "nope" }), ctx);
    assertEquals((await res.json()).result, null);
  });

  await t.step("del removes key", async () => {
    const ctx = await makeCtx();
    const token = await signScopeToken(ctx.scopeKey, scope);
    await handleKv(kvReq(token, { op: "set", key: "k1", value: "v1" }), ctx);
    await handleKv(kvReq(token, { op: "del", key: "k1" }), ctx);
    const res = await handleKv(kvReq(token, { op: "get", key: "k1" }), ctx);
    assertEquals((await res.json()).result, null);
  });

  await t.step("keys lists stored keys", async () => {
    const ctx = await makeCtx();
    const token = await signScopeToken(ctx.scopeKey, scope);
    await handleKv(kvReq(token, { op: "set", key: "a", value: "1" }), ctx);
    await handleKv(kvReq(token, { op: "set", key: "b", value: "2" }), ctx);
    const body = await (
      await handleKv(kvReq(token, { op: "keys" }), ctx)
    ).json();
    assertEquals(body.result.sort(), ["a", "b"]);
  });

  await t.step("scope isolation", async () => {
    const ctx = await makeCtx();
    const other: AgentScope = { ownerHash: "owner1", slug: "ns/agent-b" };
    const tokenA = await signScopeToken(ctx.scopeKey, scope);
    const tokenB = await signScopeToken(ctx.scopeKey, other);

    await handleKv(
      kvReq(tokenA, { op: "set", key: "secret", value: "agent-a-data" }),
      ctx,
    );

    const getRes = await handleKv(
      kvReq(tokenB, { op: "get", key: "secret" }),
      ctx,
    );
    assertEquals((await getRes.json()).result, null);

    const keysRes = await handleKv(kvReq(tokenB, { op: "keys" }), ctx);
    assertEquals((await keysRes.json()).result, []);
  });

  await t.step("set requires key", async () => {
    const ctx = await makeCtx();
    const token = await signScopeToken(ctx.scopeKey, scope);
    assertEquals(
      (await handleKv(kvReq(token, { op: "set", value: "v" }), ctx)).status,
      400,
    );
  });

  await t.step("set requires value", async () => {
    const ctx = await makeCtx();
    const token = await signScopeToken(ctx.scopeKey, scope);
    assertEquals(
      (await handleKv(kvReq(token, { op: "set", key: "k" }), ctx)).status,
      400,
    );
  });

  await t.step("get requires key", async () => {
    const ctx = await makeCtx();
    const token = await signScopeToken(ctx.scopeKey, scope);
    assertEquals(
      (await handleKv(kvReq(token, { op: "get" }), ctx)).status,
      400,
    );
  });

  await t.step("del requires key", async () => {
    const ctx = await makeCtx();
    const token = await signScopeToken(ctx.scopeKey, scope);
    assertEquals(
      (await handleKv(kvReq(token, { op: "del" }), ctx)).status,
      400,
    );
  });
});
