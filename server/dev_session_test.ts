import { expect } from "@std/expect";
import { stub } from "@std/testing/mock";
import {
  _internals,
  handleDevWebSocket,
  registerDevAgent,
} from "./dev_session.ts";
import type { DevRegister } from "@aai/core/protocol";
import type { ServerContext } from "./types.ts";
import { createTestStore, createTestScopeKey } from "./_test_utils.ts";
import { MockWebSocket } from "./_mock_ws.ts";
import { hashApiKey } from "./deploy.ts";
import { flush } from "./_test_utils.ts";

async function setup(): Promise<ServerContext> {
  return {
    slots: new Map(),
    devSlots: new Map(),
    sessions: new Map(),
    store: createTestStore(),
    scopeKey: await createTestScopeKey(),
  };
}

function upgradeStub(mockSocket: MockWebSocket) {
  return stub(
    _internals,
    "upgradeWebSocket",
    () => ({
      socket: mockSocket as unknown as WebSocket,
      response: new Response(null, { status: 101 }),
    }),
  );
}

// --- handleDevWebSocket ---

Deno.test("handleDevWebSocket returns 400 without upgrade header", async () => {
  const ctx = await setup();
  const req = new Request("http://localhost/dev/test");
  const res = handleDevWebSocket(req, "test", ctx);
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toBe("Expected WebSocket upgrade");
});

Deno.test("handleDevWebSocket upgrades WebSocket connection", async () => {
  const ctx = await setup();
  const req = new Request("http://localhost/dev/test", {
    headers: { upgrade: "websocket" },
  });

  const mockSocket = new MockWebSocket("ws://test");
  const s = upgradeStub(mockSocket);
  try {
    const res = handleDevWebSocket(req, "test", ctx);
    expect(res.status).toBe(101);
  } finally {
    s.restore();
  }
});

Deno.test("handleDevWebSocket rejects non-auth first message", async () => {
  const ctx = await setup();
  const req = new Request("http://localhost/dev/test", {
    headers: { upgrade: "websocket" },
  });

  const mockSocket = new MockWebSocket("ws://test");
  const s = upgradeStub(mockSocket);
  try {
    handleDevWebSocket(req, "test", ctx);
  } finally {
    s.restore();
  }

  await flush();

  // Send a dev_register before dev_auth — should be rejected
  mockSocket.simulateMessage(JSON.stringify({
    type: "dev_register",
    config: {
      name: "Agent",
      instructions: "test",
      greeting: "hi",
      voice: "luna",
    },
    toolSchemas: [],
    env: {},
    transport: ["websocket"],
    client: "",
  }));

  await flush();

  const sent = mockSocket.sentJson();
  const errorMsg = sent.find((m) => m.type === "dev_error");
  expect(errorMsg).toBeDefined();
  expect(errorMsg!.message).toContain("dev_auth");
});

Deno.test("handleDevWebSocket authenticates and registers via protocol", async () => {
  const ctx = await setup();
  const req = new Request("http://localhost/dev/ns/agent", {
    headers: { upgrade: "websocket" },
  });

  const mockSocket = new MockWebSocket("ws://test");
  const s = upgradeStub(mockSocket);
  try {
    handleDevWebSocket(req, "ns/agent", ctx);
  } finally {
    s.restore();
  }

  await flush();

  // Phase 1: Send dev_auth
  mockSocket.simulateMessage(JSON.stringify({
    type: "dev_auth",
    token: "my-api-key",
  }));

  await flush();
  await flush();

  const sent = mockSocket.sentJson();
  const authMsg = sent.find((m) => m.type === "dev_authenticated");
  expect(authMsg).toBeDefined();

  // Phase 2: Send dev_register
  mockSocket.simulateMessage(JSON.stringify({
    type: "dev_register",
    config: {
      name: "Test Agent",
      instructions: "test",
      greeting: "hi",
      voice: "luna",
    },
    toolSchemas: [],
    env: {},
    transport: ["websocket"],
    client: "console.log('client');",
  }));

  await flush();
  await flush();
  await flush();

  const allSent = mockSocket.sentJson();
  const regMsg = allSent.find((m) => m.type === "dev_registered");
  expect(regMsg).toBeDefined();
  expect(ctx.devSlots.has("ns/agent")).toBe(true);
  expect(ctx.devSlots.get("ns/agent")!._dev).toBe(true);
});

Deno.test("handleDevWebSocket cleans up dev slot on close", async () => {
  const ctx = await setup();
  const req = new Request("http://localhost/dev/test", {
    headers: { upgrade: "websocket" },
  });

  const mockSocket = new MockWebSocket("ws://test");
  const s = upgradeStub(mockSocket);
  try {
    handleDevWebSocket(req, "test", ctx);
  } finally {
    s.restore();
  }

  // Simulate a dev slot existing
  ctx.devSlots.set("test", {
    slug: "test",
    env: {},
    transport: ["websocket"],
    activeSessions: 0,
    _dev: true,
  });

  // Simulate close
  mockSocket.dispatchEvent(new CloseEvent("close", { code: 1000 }));
  expect(ctx.devSlots.has("test")).toBe(false);
});

Deno.test("handleDevWebSocket does not affect production slots on close", async () => {
  const ctx = await setup();
  const req = new Request("http://localhost/dev/test", {
    headers: { upgrade: "websocket" },
  });

  const mockSocket = new MockWebSocket("ws://test");
  const s = upgradeStub(mockSocket);
  try {
    handleDevWebSocket(req, "test", ctx);
  } finally {
    s.restore();
  }

  // Production slot with same slug should not be affected
  ctx.slots.set("test", {
    slug: "test",
    env: {},
    transport: ["websocket"],
    activeSessions: 0,
  });

  mockSocket.dispatchEvent(new CloseEvent("close", { code: 1000 }));
  expect(ctx.slots.has("test")).toBe(true);
});

Deno.test("handleDevWebSocket rejects different owner for claimed namespace", async () => {
  const ctx = await setup();

  // First owner claims the namespace
  await ctx.store.putNamespaceOwner("ns", await hashApiKey("owner-key"));

  const req = new Request("http://localhost/dev/ns/agent", {
    headers: { upgrade: "websocket" },
  });

  const mockSocket = new MockWebSocket("ws://test");
  const s = upgradeStub(mockSocket);
  try {
    handleDevWebSocket(req, "ns/agent", ctx);
  } finally {
    s.restore();
  }

  // Wait for MockWebSocket open event (queued microtask)
  await flush();

  // Phase 1: Attacker sends dev_auth with their key
  mockSocket.simulateMessage(JSON.stringify({
    type: "dev_auth",
    token: "attacker-key",
  }));

  // Wait for async namespace ownership check to complete
  await flush();
  await flush();

  // Should have sent a dev_error and no slot created
  const sent = mockSocket.sentJson();
  const errorMsg = sent.find((m) => m.type === "dev_error");
  expect(errorMsg).toBeDefined();
  expect(errorMsg!.message).toContain("owned by another user");
  expect(ctx.devSlots.has("ns/agent")).toBe(false);
});

// --- registerDevAgent ---

function makeDevRegister(
  overrides?: Partial<DevRegister>,
): DevRegister {
  return {
    type: "dev_register",
    transport: ["websocket"],
    config: {
      name: "Dev Agent",
      instructions: "test instructions",
      greeting: "hi",
      voice: "luna",
    },
    toolSchemas: [],
    env: { ASSEMBLYAI_API_KEY: "test-key" },
    client: "console.log('client');",
    ...overrides,
  };
}

Deno.test("registerDevAgent creates dev slot without persisting to store", async () => {
  const ctx = await setup();
  const ws = new MockWebSocket("ws://test");
  await flush();

  const msg = makeDevRegister();
  const ownerHash = await hashApiKey("test-api-key");

  await registerDevAgent(
    ws as unknown as WebSocket,
    "ns/dev-agent",
    msg,
    ownerHash,
    "http://localhost:3000",
    ctx,
  );

  // Dev slot should be created
  const slot = ctx.devSlots.get("ns/dev-agent");
  expect(slot).toBeDefined();
  expect(slot!.name).toBe("Dev Agent");
  expect(slot!._dev).toBe(true);
  expect(slot!.env.AAI_KV_URL).toBe("http://localhost:3000/kv");
  expect(slot!.env.AAI_SCOPE_TOKEN).toBeDefined();

  // Production slots should not be affected
  expect(ctx.slots.has("ns/dev-agent")).toBe(false);

  // Should have sent dev_registered
  const sent = ws.sentJson();
  expect(sent.length).toBeGreaterThanOrEqual(1);
  const regMsg = sent.find((m) => m.type === "dev_registered");
  expect(regMsg).toBeDefined();
  expect(regMsg!.slug).toBe("ns/dev-agent");

  // Should NOT be stored
  const manifest = await ctx.store.getManifest("ns/dev-agent");
  expect(manifest).toBe(null);
});

Deno.test("registerDevAgent terminates existing worker", async () => {
  const ctx = await setup();
  const ws = new MockWebSocket("ws://test");
  await flush();

  let terminated = false;
  ctx.devSlots.set("ns/dev-agent", {
    slug: "ns/dev-agent",
    env: {},
    transport: ["websocket"],
    activeSessions: 2,
    worker: {
      handle: {
        terminate() {
          terminated = true;
        },
      },
      api: {} as ReturnType<
        typeof import("@aai/core/worker-entry").createWorkerApi
      >,
    },
  });

  const msg = makeDevRegister();
  const ownerHash = await hashApiKey("key");

  await registerDevAgent(
    ws as unknown as WebSocket,
    "ns/dev-agent",
    msg,
    ownerHash,
    "http://localhost:3000",
    ctx,
  );

  expect(terminated).toBe(true);
  // Should preserve activeSessions count
  expect(ctx.devSlots.get("ns/dev-agent")!.activeSessions).toBe(2);
});

Deno.test("registerDevAgent includes builtin tools in log", async () => {
  const ctx = await setup();
  const ws = new MockWebSocket("ws://test");
  await flush();

  const msg = makeDevRegister({
    config: {
      name: "Tool Agent",
      instructions: "test",
      greeting: "hi",
      voice: "luna",
      builtinTools: ["web_search"],
    },
    toolSchemas: [
      {
        name: "custom_tool",
        description: "A custom tool",
        parameters: { type: "object", properties: {} },
      },
    ],
  });

  await registerDevAgent(
    ws as unknown as WebSocket,
    "ns/tool-agent",
    msg,
    await hashApiKey("key"),
    "http://localhost:3000",
    ctx,
  );

  const slot = ctx.devSlots.get("ns/tool-agent");
  expect(slot).toBeDefined();
  expect(slot!.toolSchemas).toEqual(msg.toolSchemas);
});
