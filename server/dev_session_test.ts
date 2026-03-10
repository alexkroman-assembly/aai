import { expect } from "@std/expect";
import { stub } from "@std/testing/mock";
import {
  _internals,
  handleDevWebSocket,
  registerDevAgent,
} from "./dev_session.ts";
import type { DevRegister } from "@aai/core/protocol";
import type { ServerContext } from "./types.ts";
import { createTestStore, createTestTokenSigner } from "./_test_utils.ts";
import { MockWebSocket } from "./_mock_ws.ts";
import { hashApiKey } from "./deploy.ts";
import { flush } from "./_test_utils.ts";

async function setup(): Promise<ServerContext> {
  return {
    slots: new Map(),
    sessions: new Map(),
    store: createTestStore(),
    tokenSigner: await createTestTokenSigner(),
  };
}

// --- handleDevWebSocket ---

Deno.test("handleDevWebSocket returns 400 without upgrade header", async () => {
  const ctx = await setup();
  const req = new Request("http://localhost/dev/test?token=abc");
  const res = handleDevWebSocket(req, "test", ctx);
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toBe("Expected WebSocket upgrade");
});

Deno.test("handleDevWebSocket returns 401 without token", async () => {
  const ctx = await setup();
  const req = new Request("http://localhost/dev/test", {
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
    const res = handleDevWebSocket(req, "test", ctx);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Missing token parameter");
  } finally {
    upgradeStub.restore();
  }
});

Deno.test("handleDevWebSocket upgrades with valid token", () => {
  // deno-lint-ignore no-async-promise-executor
  return new Promise<void>(async (resolve) => {
    const ctx = await setup();
    const req = new Request("http://localhost/dev/test?token=mykey", {
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
      const res = handleDevWebSocket(req, "test", ctx);
      expect(res.status).toBe(101);
    } finally {
      upgradeStub.restore();
    }
    resolve();
  });
});

Deno.test("handleDevWebSocket cleans up dev slot on close", async () => {
  const ctx = await setup();
  const req = new Request("http://localhost/dev/test?token=mykey", {
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
    handleDevWebSocket(req, "test", ctx);
  } finally {
    upgradeStub.restore();
  }

  // Simulate a dev slot existing
  ctx.slots.set("test", {
    slug: "test",
    env: {},
    transport: ["websocket"],
    activeSessions: 0,
    _dev: true,
  });

  // Simulate close
  mockSocket.dispatchEvent(new CloseEvent("close", { code: 1000 }));
  expect(ctx.slots.has("test")).toBe(false);
});

Deno.test("handleDevWebSocket does not remove non-dev slot on close", async () => {
  const ctx = await setup();
  const req = new Request("http://localhost/dev/test?token=mykey", {
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
    handleDevWebSocket(req, "test", ctx);
  } finally {
    upgradeStub.restore();
  }

  // Non-dev slot
  ctx.slots.set("test", {
    slug: "test",
    env: {},
    transport: ["websocket"],
    activeSessions: 0,
    _dev: false,
  });

  mockSocket.dispatchEvent(new CloseEvent("close", { code: 1000 }));
  expect(ctx.slots.has("test")).toBe(true);
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

Deno.test("registerDevAgent creates slot and stores agent", async () => {
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

  // Slot should be created
  const slot = ctx.slots.get("ns/dev-agent");
  expect(slot).toBeDefined();
  expect(slot!.name).toBe("Dev Agent");
  expect(slot!._dev).toBe(true);
  expect(slot!.env.AAI_KV_URL).toBe("http://localhost:3000/kv");
  expect(slot!.env.AAI_SCOPE_TOKEN).toBeDefined();

  // Should have sent dev_registered
  const sent = ws.sentJson();
  expect(sent.length).toBeGreaterThanOrEqual(1);
  const regMsg = sent.find((m) => m.type === "dev_registered");
  expect(regMsg).toBeDefined();
  expect(regMsg!.slug).toBe("ns/dev-agent");

  // Should be stored
  const manifest = await ctx.store.getManifest("ns/dev-agent");
  expect(manifest).not.toBe(null);
});

Deno.test("registerDevAgent terminates existing worker", async () => {
  const ctx = await setup();
  const ws = new MockWebSocket("ws://test");
  await flush();

  let terminated = false;
  ctx.slots.set("ns/dev-agent", {
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
  expect(ctx.slots.get("ns/dev-agent")!.activeSessions).toBe(2);
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

  const slot = ctx.slots.get("ns/tool-agent");
  expect(slot).toBeDefined();
  expect(slot!.toolSchemas).toEqual(msg.toolSchemas);
});
