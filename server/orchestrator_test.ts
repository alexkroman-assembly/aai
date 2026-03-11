import { assertEquals, assertStringIncludes } from "@std/assert";
import { expect } from "@std/expect";
import { stub } from "@std/testing/mock";
import { createOrchestrator } from "./orchestrator.ts";
import { _internals } from "./transport_websocket.ts";
import { _internals as devInternals } from "./dev_session.ts";
import { hashApiKey } from "./auth.ts";
import { signScopeToken } from "./scope_token.ts";
import {
  createTestKvStore,
  createTestScopeKey,
  createTestStore,
  DUMMY_INFO,
  VALID_ENV,
} from "./_test_utils.ts";
import { MockWebSocket } from "./_mock_ws.ts";

function deployBody(overrides?: Record<string, unknown>) {
  return JSON.stringify({
    env: VALID_ENV,
    worker: "console.log('w');",
    client: "console.log('c');",
    config: {
      instructions: "test",
      greeting: "hello",
      voice: "luna",
    },
    ...overrides,
  });
}

async function createTestOrchestrator() {
  const store = createTestStore();
  const scopeKey = await createTestScopeKey();
  const kvStore = createTestKvStore();
  const handler = createOrchestrator({ store, scopeKey, kvStore });
  return { handler, store, scopeKey, kvStore };
}

function req(path: string, init?: RequestInit) {
  return new Request(`http://localhost${path}`, init);
}

// =============================================================================
// Public routes
// =============================================================================

Deno.test("returns landing page for root path", async () => {
  const { handler } = await createTestOrchestrator();
  const res = await handler(req("/"), DUMMY_INFO);
  assertEquals(res.status, 200);
  assertStringIncludes(await res.text(), "</html>");
});

Deno.test("returns health check", async () => {
  const { handler } = await createTestOrchestrator();
  const res = await handler(req("/health"), DUMMY_INFO);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "ok");
});

Deno.test("returns Prometheus metrics", async () => {
  const { handler } = await createTestOrchestrator();
  const res = await handler(req("/metrics"), DUMMY_INFO);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "text/plain; version=0.0.4");
  assertStringIncludes(await res.text(), "aai_sessions_total");
});

Deno.test("returns favicon SVG", async () => {
  const { handler } = await createTestOrchestrator();
  const res = await handler(req("/favicon.svg"), DUMMY_INFO);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "image/svg+xml");
  assertStringIncludes(await res.text(), "<svg");
});

Deno.test("returns install script", async () => {
  const { handler } = await createTestOrchestrator();
  const res = await handler(req("/install"), DUMMY_INFO);
  assertEquals(res.status, 200);
  const body = await res.text();
  assertStringIncludes(body, "#!/bin/sh");
  assertStringIncludes(body, "alexkroman/aai");
});

Deno.test("returns 404 for unknown paths", async () => {
  const { handler } = await createTestOrchestrator();
  assertEquals(
    (await handler(req("/nonexistent"), DUMMY_INFO)).status,
    404,
  );
  assertEquals(
    (await handler(req("/foo/bar/baz"), DUMMY_INFO)).status,
    404,
  );
});

// =============================================================================
// Security headers
// =============================================================================

Deno.test("adds Cross-Origin-Isolation headers", async () => {
  const { handler } = await createTestOrchestrator();
  const res = await handler(req("/health"), DUMMY_INFO);
  assertEquals(res.headers.get("Cross-Origin-Opener-Policy"), "same-origin");
  assertEquals(
    res.headers.get("Cross-Origin-Embedder-Policy"),
    "credentialless",
  );
});

// =============================================================================
// Deploy
// =============================================================================

Deno.test("deploy rejects without auth", async () => {
  const { handler } = await createTestOrchestrator();
  const res = await handler(
    req("/ns/agent/deploy", { method: "POST", body: deployBody() }),
    DUMMY_INFO,
  );
  assertEquals(res.status, 401);
});

Deno.test("deploy rejects different owner for claimed namespace", async () => {
  const { handler, store } = await createTestOrchestrator();
  await store.putNamespaceOwner("ns", await hashApiKey("key1"));

  const res = await handler(
    req("/ns/agent/deploy", {
      method: "POST",
      headers: { Authorization: "Bearer key2" },
      body: deployBody(),
    }),
    DUMMY_INFO,
  );
  assertEquals(res.status, 403);
});

Deno.test("deploy succeeds and stores agent", async () => {
  const { handler, store } = await createTestOrchestrator();
  const res = await handler(
    req("/ns/my-agent/deploy", {
      method: "POST",
      headers: {
        Authorization: "Bearer key1",
        "Content-Type": "application/json",
      },
      body: deployBody(),
    }),
    DUMMY_INFO,
  );
  assertEquals(res.status, 200);
  const manifest = await store.getManifest("ns/my-agent");
  assertEquals(manifest!.owner_hash, await hashApiKey("key1"));
});

Deno.test("deploy can redeploy same slug", async () => {
  const { handler } = await createTestOrchestrator();
  const init = {
    method: "POST",
    headers: {
      Authorization: "Bearer key1",
      "Content-Type": "application/json",
    },
    body: deployBody(),
  };
  await handler(req("/ns/my-agent/deploy", init), DUMMY_INFO);
  const res = await handler(
    req("/ns/my-agent/deploy", {
      ...init,
      body: deployBody(),
    }),
    DUMMY_INFO,
  );
  assertEquals(res.status, 200);
});

Deno.test("deploy rejects missing config", async () => {
  const { handler } = await createTestOrchestrator();
  const res = await handler(
    req("/ns/agent/deploy", {
      method: "POST",
      headers: {
        Authorization: "Bearer key1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        env: VALID_ENV,
        worker: "console.log('w');",
        client: "console.log('c');",
      }),
    }),
    DUMMY_INFO,
  );
  assertEquals(res.status, 400);
  assertStringIncludes((await res.json()).error, "config");
});

// =============================================================================
// Agent health & page (requires deployed agent)
// =============================================================================

async function deployAgent(
  handler: Deno.ServeHandler,
  slug = "ns/agent",
  key = "key1",
) {
  await handler(
    req(`/${slug}/deploy`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: deployBody(),
    }),
    DUMMY_INFO,
  );
}

Deno.test("agent health returns 404 for unknown agent", async () => {
  const { handler } = await createTestOrchestrator();
  const res = await handler(req("/ns/missing/health"), DUMMY_INFO);
  assertEquals(res.status, 404);
});

Deno.test("agent health returns ok for deployed agent", async () => {
  const { handler } = await createTestOrchestrator();
  await deployAgent(handler);
  const res = await handler(req("/ns/agent/health"), DUMMY_INFO);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "ok");
  assertEquals(body.slug, "ns/agent");
});

Deno.test("agent page returns 404 for unknown agent", async () => {
  const { handler } = await createTestOrchestrator();
  const res = await handler(req("/ns/missing"), DUMMY_INFO);
  assertEquals(res.status, 404);
});

Deno.test("agent page returns HTML for deployed agent", async () => {
  const { handler } = await createTestOrchestrator();
  await deployAgent(handler);
  const res = await handler(req("/ns/agent"), DUMMY_INFO);
  assertEquals(res.status, 200);
  expect(res.headers.get("Content-Type")).toContain("text/html");
  const body = await res.text();
  assertStringIncludes(body, 'src="/ns/agent/client.js"');
});

// =============================================================================
// Static files
// =============================================================================

Deno.test("static file returns 404 for unknown agent", async () => {
  const { handler } = await createTestOrchestrator();
  const res = await handler(req("/ns/missing/client.js"), DUMMY_INFO);
  assertEquals(res.status, 404);
});

Deno.test("static file serves client.js after deploy", async () => {
  const { handler } = await createTestOrchestrator();
  await deployAgent(handler);
  const res = await handler(req("/ns/agent/client.js"), DUMMY_INFO);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "application/javascript");
  assertStringIncludes(await res.text(), "console.log");
});

// =============================================================================
// WebSocket
// =============================================================================

Deno.test("websocket returns 404 for unknown agent", async () => {
  const { handler } = await createTestOrchestrator();
  const res = await handler(
    req("/ns/missing/websocket", { headers: { upgrade: "websocket" } }),
    DUMMY_INFO,
  );
  assertEquals(res.status, 404);
});

Deno.test("websocket returns 400 without upgrade header", async () => {
  const { handler } = await createTestOrchestrator();
  await deployAgent(handler);
  const res = await handler(req("/ns/agent/websocket"), DUMMY_INFO);
  assertEquals(res.status, 400);
});

Deno.test("websocket upgrades for deployed agent", async () => {
  const { handler } = await createTestOrchestrator();
  await deployAgent(handler);

  const mockSocket = new MockWebSocket("ws://test");
  const upgradeStub = stub(
    _internals,
    "upgradeWebSocket",
    () => ({
      socket: mockSocket as unknown as WebSocket,
      response: new Response(null, { status: 101 }),
    }),
  );
  try {
    const res = await handler(
      req("/ns/agent/websocket", { headers: { upgrade: "websocket" } }),
      DUMMY_INFO,
    );
    assertEquals(res.status, 101);
  } finally {
    upgradeStub.restore();
  }
});

// =============================================================================
// Per-agent metrics
// =============================================================================

Deno.test("per-agent metrics returns Prometheus format", async () => {
  const { handler } = await createTestOrchestrator();
  const res = await handler(
    req("/test-ns/test-agent/metrics"),
    DUMMY_INFO,
  );
  assertEquals(res.status, 200);
  assertEquals(
    res.headers.get("Content-Type"),
    "text/plain; version=0.0.4",
  );
  const body = await res.text();
  assertStringIncludes(body, "aai_sessions_total");
  assertStringIncludes(body, "aai_tool_duration_seconds");
  // Global metrics should not appear
  assertEquals(body.includes("aai_llm_duration_seconds"), false);
});

// =============================================================================
// KV (requires scope token)
// =============================================================================

Deno.test("kv rejects without auth", async () => {
  const { handler } = await createTestOrchestrator();
  const res = await handler(
    req("/ns/agent/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "get", key: "k" }),
    }),
    DUMMY_INFO,
  );
  assertEquals(res.status, 401);
});

Deno.test("kv set and get round-trip", async () => {
  const { handler, scopeKey } = await createTestOrchestrator();
  const ownerHash = await hashApiKey("key1");
  const token = await signScopeToken(scopeKey, {
    ownerHash,
    slug: "ns/agent",
  });

  const kvReq = (body: Record<string, unknown>) =>
    req("/ns/agent/kv", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

  const setRes = await handler(
    kvReq({ op: "set", key: "k1", value: "v1" }),
    DUMMY_INFO,
  );
  assertEquals(setRes.status, 200);
  assertEquals((await setRes.json()).result, "OK");

  const getRes = await handler(
    kvReq({ op: "get", key: "k1" }),
    DUMMY_INFO,
  );
  assertEquals((await getRes.json()).result, "v1");
});

Deno.test("kv scope isolation", async () => {
  const { handler, scopeKey } = await createTestOrchestrator();
  const ownerHash = await hashApiKey("key1");
  const tokenA = await signScopeToken(scopeKey, {
    ownerHash,
    slug: "ns/agent-a",
  });
  const tokenB = await signScopeToken(scopeKey, {
    ownerHash,
    slug: "ns/agent-b",
  });

  // Set via agent-a
  await handler(
    req("/ns/agent-a/kv", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenA}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ op: "set", key: "secret", value: "a-data" }),
    }),
    DUMMY_INFO,
  );

  // Get via agent-b — should be null
  const res = await handler(
    req("/ns/agent-b/kv", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenB}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ op: "get", key: "secret" }),
    }),
    DUMMY_INFO,
  );
  assertEquals((await res.json()).result, null);
});

Deno.test("kv rejects invalid op", async () => {
  const { handler, scopeKey } = await createTestOrchestrator();
  const token = await signScopeToken(scopeKey, {
    ownerHash: "h",
    slug: "ns/agent",
  });
  const res = await handler(
    req("/ns/agent/kv", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ op: "drop_table" }),
    }),
    DUMMY_INFO,
  );
  assertEquals(res.status, 400);
});

// =============================================================================
// Dev WebSocket
// =============================================================================

Deno.test("dev websocket returns 400 without upgrade header", async () => {
  const { handler } = await createTestOrchestrator();
  const res = await handler(req("/ns/agent/dev"), DUMMY_INFO);
  assertEquals(res.status, 400);
});

Deno.test("dev websocket upgrades connection", async () => {
  const { handler } = await createTestOrchestrator();
  const mockSocket = new MockWebSocket("ws://test");
  const upgradeStub = stub(
    devInternals,
    "upgradeWebSocket",
    () => ({
      socket: mockSocket as unknown as WebSocket,
      response: new Response(null, { status: 101 }),
    }),
  );
  try {
    const res = await handler(
      req("/ns/agent/dev", { headers: { upgrade: "websocket" } }),
      DUMMY_INFO,
    );
    assertEquals(res.status, 101);
  } finally {
    upgradeStub.restore();
  }
});
