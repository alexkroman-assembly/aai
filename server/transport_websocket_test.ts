import { expect } from "@std/expect";
import { assertSpyCalls, stub } from "@std/testing/mock";
import {
  _internals,
  discoverSlot,
  handleAgentHealth,
  handleAgentPage,
  handleAgentRedirect,
  handleStaticFile,
  handleWebSocket,
  resolveSlot,
} from "./transport_websocket.ts";
import type { AgentSlot } from "./worker_pool.ts";
import type { ServerContext } from "./types.ts";
import { createTestStore, createTestScopeKey } from "./_test_utils.ts";
import { MockWebSocket } from "./_mock_ws.ts";

const VALID_ENV = { ASSEMBLYAI_API_KEY: "test-key" };

function makeSlot(overrides?: Partial<AgentSlot>): AgentSlot {
  return {
    slug: "ns/test-agent",
    env: VALID_ENV,
    transport: ["websocket"],
    config: {
      name: "Test Agent",
      instructions: "test",
      greeting: "hello",
      voice: "luna",
    },
    name: "Test Agent",
    toolSchemas: [],
    activeSessions: 0,
    ...overrides,
  };
}

async function setup(slots?: Map<string, AgentSlot>): Promise<ServerContext> {
  return {
    slots: slots ?? new Map(),
    devSlots: new Map(),
    sessions: new Map(),
    store: createTestStore(),
    scopeKey: await createTestScopeKey(),
  };
}

const dummyReq = new Request("http://localhost/test");

// --- discoverSlot ---

Deno.test("discoverSlot returns existing slot from map", async () => {
  const slot = makeSlot();
  const ctx = await setup(new Map([["ns/test-agent", slot]]));
  const result = await discoverSlot("ns/test-agent", ctx);
  expect(result).toBe(slot);
});

Deno.test("discoverSlot returns null when not in map and not in store", async () => {
  const ctx = await setup();
  const result = await discoverSlot("ns/missing", ctx);
  expect(result).toBe(null);
});

Deno.test("discoverSlot lazy-loads from store", async () => {
  const ctx = await setup();
  await ctx.store.putAgent({
    slug: "ns/stored-agent",
    env: VALID_ENV,
    transport: ["websocket"],
    worker: "console.log('w');",
    client: "console.log('c');",
    config: {
      instructions: "test",
      greeting: "hello",
      voice: "luna",
    },
  });
  const result = await discoverSlot("ns/stored-agent", ctx);
  expect(result).not.toBe(null);
  expect(result!.slug).toBe("ns/stored-agent");
  expect(ctx.slots.has("ns/stored-agent")).toBe(true);
});

// --- resolveSlot ---

Deno.test("resolveSlot returns null for twilio-only slot", async () => {
  const slot = makeSlot({ transport: ["twilio"] });
  const ctx = await setup(new Map([["ns/twilio-only", slot]]));
  const result = await resolveSlot("ns/twilio-only", ctx);
  expect(result).toBe(null);
});

Deno.test("resolveSlot returns slot with websocket transport", async () => {
  const slot = makeSlot({ transport: ["websocket", "twilio"] });
  const ctx = await setup(new Map([["ns/both", slot]]));
  const result = await resolveSlot("ns/both", ctx);
  expect(result).toBe(slot);
});

// --- handleAgentHealth ---

Deno.test("handleAgentHealth returns 404 for unknown agent", async () => {
  const ctx = await setup();
  const res = await handleAgentHealth(dummyReq, "ns/missing", ctx);
  expect(res.status).toBe(404);
  const body = await res.json();
  expect(body.error).toBe("Not found");
});

Deno.test("handleAgentHealth returns ok with name", async () => {
  const slot = makeSlot({ name: "My Agent" });
  const ctx = await setup(new Map([["ns/agent", slot]]));
  const res = await handleAgentHealth(dummyReq, "ns/agent", ctx);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.status).toBe("ok");
  expect(body.name).toBe("My Agent");
  expect(body.slug).toBe("ns/agent");
});

Deno.test("handleAgentHealth falls back to slug when name missing", async () => {
  const slot = makeSlot({ name: undefined });
  const ctx = await setup(new Map([["ns/agent", slot]]));
  const res = await handleAgentHealth(dummyReq, "ns/agent", ctx);
  const body = await res.json();
  expect(body.name).toBe("ns/agent");
});

// --- handleAgentPage ---

Deno.test("handleAgentPage returns 404 for unknown agent", async () => {
  const ctx = await setup();
  const res = await handleAgentPage(dummyReq, "ns/missing", ctx);
  expect(res.status).toBe(404);
});

Deno.test("handleAgentPage returns HTML with agent name and script", async () => {
  const slot = makeSlot({ name: "Cool Agent" });
  const ctx = await setup(new Map([["ns/cool", slot]]));
  const res = await handleAgentPage(dummyReq, "ns/cool", ctx);
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("text/html; charset=UTF-8");
  const body = await res.text();
  expect(body).toContain("Cool Agent");
  expect(body).toContain('src="/ns/cool/client.js"');
});

// --- handleAgentRedirect ---

Deno.test("handleAgentRedirect returns 404 for unknown agent", async () => {
  const ctx = await setup();
  const res = await handleAgentRedirect(dummyReq, "ns/missing", ctx);
  expect(res.status).toBe(404);
});

Deno.test("handleAgentRedirect returns 301 with trailing slash", async () => {
  const slot = makeSlot();
  const ctx = await setup(new Map([["ns/agent", slot]]));
  const res = await handleAgentRedirect(dummyReq, "ns/agent", ctx);
  expect(res.status).toBe(301);
  expect(res.headers.get("Location")).toBe("/ns/agent/");
});

// --- handleWebSocket ---

Deno.test("handleWebSocket returns 404 for unknown agent", async () => {
  const ctx = await setup();
  const req = new Request("http://localhost/ns/missing/ws", {
    headers: { upgrade: "websocket" },
  });
  const res = await handleWebSocket(req, "ns/missing", ctx);
  expect(res.status).toBe(404);
});

Deno.test("handleWebSocket returns 400 without upgrade header", async () => {
  const slot = makeSlot();
  const ctx = await setup(new Map([["ns/agent", slot]]));
  const req = new Request("http://localhost/ns/agent/ws");
  const res = await handleWebSocket(req, "ns/agent", ctx);
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toBe("Expected WebSocket upgrade");
});

Deno.test("handleWebSocket upgrades and returns response", async () => {
  const slot = makeSlot();
  const ctx = await setup(new Map([["ns/agent", slot]]));
  const req = new Request("http://localhost/ns/agent/ws", {
    headers: { upgrade: "websocket" },
  });

  const mockSocket = new MockWebSocket("ws://test");
  const mockResponse = new Response(null, { status: 101 });
  const upgradeStub = stub(
    _internals,
    "upgradeWebSocket",
    () => ({
      socket: mockSocket as unknown as WebSocket,
      response: mockResponse,
    }),
  );
  try {
    const res = await handleWebSocket(req, "ns/agent", ctx);
    expect(res.status).toBe(101);
    assertSpyCalls(upgradeStub, 1);
  } finally {
    upgradeStub.restore();
  }
});

Deno.test("handleWebSocket passes resume flag from query string", async () => {
  const slot = makeSlot();
  const ctx = await setup(new Map([["ns/agent", slot]]));
  const req = new Request("http://localhost/ns/agent/ws?resume", {
    headers: { upgrade: "websocket" },
  });

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
    const res = await handleWebSocket(req, "ns/agent", ctx);
    expect(res.status).toBe(101);
  } finally {
    upgradeStub.restore();
  }
});

// --- handleStaticFile ---

Deno.test("handleStaticFile returns 404 for unknown agent", async () => {
  const ctx = await setup();
  const res = await handleStaticFile(dummyReq, "ns/missing", "client.js", ctx);
  expect(res.status).toBe(404);
});

Deno.test("handleStaticFile returns 404 for unknown file name", async () => {
  const slot = makeSlot();
  const ctx = await setup(new Map([["ns/agent", slot]]));
  const res = await handleStaticFile(dummyReq, "ns/agent", "hacker.js", ctx);
  expect(res.status).toBe(404);
});

Deno.test("handleStaticFile returns 404 when file not in store", async () => {
  const slot = makeSlot();
  const ctx = await setup(new Map([["ns/agent", slot]]));
  const res = await handleStaticFile(dummyReq, "ns/agent", "client.js", ctx);
  expect(res.status).toBe(404);
});

Deno.test("handleStaticFile serves client.js with correct content type", async () => {
  const slot = makeSlot();
  const ctx = await setup(new Map([["ns/agent", slot]]));
  await ctx.store.putAgent({
    slug: "ns/agent",
    env: VALID_ENV,
    transport: ["websocket"],
    worker: "// worker",
    client: "console.log('hello');",
  });
  const res = await handleStaticFile(dummyReq, "ns/agent", "client.js", ctx);
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("application/javascript");
  expect(res.headers.get("Cache-Control")).toBe("no-cache");
  const body = await res.text();
  expect(body).toBe("console.log('hello');");
});

Deno.test("handleStaticFile serves client.js.map as JSON", async () => {
  const slot = makeSlot();
  const ctx = await setup(new Map([["ns/agent", slot]]));
  const mapContent = '{"version":3}';
  await ctx.store.putAgent({
    slug: "ns/agent",
    env: VALID_ENV,
    transport: ["websocket"],
    worker: "// worker",
    client: "// client",
    client_map: mapContent,
  });
  const res = await handleStaticFile(
    dummyReq,
    "ns/agent",
    "client.js.map",
    ctx,
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("application/json");
  const body = await res.text();
  expect(body).toBe(mapContent);
});
