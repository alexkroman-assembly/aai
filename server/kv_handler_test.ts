import { expect } from "@std/expect";
import { Hono } from "hono";
import type { HonoEnv } from "./hono_env.ts";
import { handleKv, validateKvRequest } from "./kv_handler.ts";

// --- helpers ---

function createMockKvStore() {
  const store = new Map<string, string>();
  return {
    store,
    get: (_scope: unknown, key: string) =>
      Promise.resolve(store.get(key) ?? null),
    set: (_scope: unknown, key: string, value: string, _ttl?: number) => {
      store.set(key, value);
      return Promise.resolve();
    },
    del: (_scope: unknown, key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
    keys: (_scope: unknown, _pattern?: string) =>
      Promise.resolve([...store.keys()]),
    list: (
      _scope: unknown,
      prefix: string,
      _opts?: { limit?: number; reverse?: boolean },
    ) =>
      Promise.resolve(
        [...store.entries()]
          .filter(([k]) => k.startsWith(prefix))
          .map(([key, value]) => ({ key, value })),
      ),
  };
}

function createApp() {
  const kvStore = createMockKvStore();
  const scope = { slug: "test-agent", accountId: "abc" };

  const app = new Hono<HonoEnv>();
  app.use("*", async (c, next) => {
    c.set("kvStore", kvStore as never);
    c.set("scope", scope as never);
    await next();
  });
  app.post("/kv", validateKvRequest, handleKv);

  return { app, kvStore };
}

async function postKv(
  app: Hono<HonoEnv>,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await app.request("/kv", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
  };
}

// --- validation ---

Deno.test("kv: rejects invalid op", async () => {
  const { app } = createApp();
  const { status, json } = await postKv(app, { op: "invalid" });
  expect(status).toBe(400);
  expect(json.error).toBeDefined();
});

Deno.test("kv: rejects missing key for get", async () => {
  const { app } = createApp();
  const { status } = await postKv(app, { op: "get" });
  expect(status).toBe(400);
});

Deno.test("kv: rejects missing key for set", async () => {
  const { app } = createApp();
  const { status } = await postKv(app, { op: "set", value: "v" });
  expect(status).toBe(400);
});

Deno.test("kv: rejects missing value for set", async () => {
  const { app } = createApp();
  const { status } = await postKv(app, { op: "set", key: "k" });
  expect(status).toBe(400);
});

Deno.test("kv: rejects missing prefix for list", async () => {
  const { app } = createApp();
  const { status } = await postKv(app, { op: "list" });
  expect(status).toBe(400);
});

// --- get ---

Deno.test("kv get: returns null for missing key", async () => {
  const { app } = createApp();
  const { status, json } = await postKv(app, { op: "get", key: "nope" });
  expect(status).toBe(200);
  expect(json.result).toBeNull();
});

Deno.test("kv get: returns stored value", async () => {
  const { app, kvStore } = createApp();
  kvStore.store.set("mykey", "myval");
  const { status, json } = await postKv(app, { op: "get", key: "mykey" });
  expect(status).toBe(200);
  expect(json.result).toBe("myval");
});

// --- set ---

Deno.test("kv set: stores value and returns OK", async () => {
  const { app, kvStore } = createApp();
  const { status, json } = await postKv(app, {
    op: "set",
    key: "k1",
    value: "v1",
  });
  expect(status).toBe(200);
  expect(json.result).toBe("OK");
  expect(kvStore.store.get("k1")).toBe("v1");
});

Deno.test("kv set: accepts optional ttl", async () => {
  const { app } = createApp();
  const { status, json } = await postKv(app, {
    op: "set",
    key: "k",
    value: "v",
    ttl: 3600,
  });
  expect(status).toBe(200);
  expect(json.result).toBe("OK");
});

// --- del ---

Deno.test("kv del: removes key and returns OK", async () => {
  const { app, kvStore } = createApp();
  kvStore.store.set("k1", "v1");
  const { status, json } = await postKv(app, { op: "del", key: "k1" });
  expect(status).toBe(200);
  expect(json.result).toBe("OK");
  expect(kvStore.store.has("k1")).toBe(false);
});

Deno.test("kv del: succeeds even if key does not exist", async () => {
  const { app } = createApp();
  const { status, json } = await postKv(app, { op: "del", key: "nope" });
  expect(status).toBe(200);
  expect(json.result).toBe("OK");
});

// --- keys ---

Deno.test("kv keys: returns all keys", async () => {
  const { app, kvStore } = createApp();
  kvStore.store.set("a", "1");
  kvStore.store.set("b", "2");
  const { status, json } = await postKv(app, { op: "keys" });
  expect(status).toBe(200);
  expect(json.result).toEqual(["a", "b"]);
});

Deno.test("kv keys: accepts optional pattern", async () => {
  const { app } = createApp();
  const { status } = await postKv(app, { op: "keys", pattern: "user:*" });
  expect(status).toBe(200);
});

// --- list ---

Deno.test("kv list: returns entries matching prefix", async () => {
  const { app, kvStore } = createApp();
  kvStore.store.set("note:1", "a");
  kvStore.store.set("note:2", "b");
  kvStore.store.set("other:1", "c");
  const { status, json } = await postKv(app, {
    op: "list",
    prefix: "note:",
  });
  expect(status).toBe(200);
  const result = json.result as { key: string; value: string }[];
  expect(result).toHaveLength(2);
  expect(result.every((r) => r.key.startsWith("note:"))).toBe(true);
});

Deno.test("kv list: accepts limit and reverse options", async () => {
  const { app } = createApp();
  const { status } = await postKv(app, {
    op: "list",
    prefix: "x:",
    limit: 10,
    reverse: true,
  });
  expect(status).toBe(200);
});

// --- error handling ---

Deno.test("kv: returns 500 when store throws", async () => {
  const kvStore = {
    get: () => Promise.reject(new Error("db down")),
    set: () => Promise.reject(new Error("db down")),
    del: () => Promise.reject(new Error("db down")),
    keys: () => Promise.reject(new Error("db down")),
    list: () => Promise.reject(new Error("db down")),
  };
  const scope = { slug: "test-agent", accountId: "abc" };

  const app = new Hono<HonoEnv>();
  app.use("*", async (c, next) => {
    c.set("kvStore", kvStore as never);
    c.set("scope", scope as never);
    await next();
  });
  app.post("/kv", validateKvRequest, handleKv);

  const { status, json } = await postKv(app, { op: "get", key: "x" });
  expect(status).toBe(500);
  expect(json.error as string).toContain("KV operation failed");
  expect(json.error as string).toContain("db down");
});
