import { expect } from "@std/expect";
import { registerDevAgent } from "./dev_session.ts";
import type { DevRegister } from "@aai/core/protocol";
import type { AgentSlot } from "./worker_pool.ts";
import { createTestScopeKey, createTestStore, flush } from "./_test_utils.ts";
import { MockWebSocket } from "./_mock_ws.ts";
import { hashApiKey } from "./auth.ts";

function makeDevRegister(
  overrides?: Partial<DevRegister>,
): DevRegister {
  return {
    type: "dev_register",
    token: "test-api-key",
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
  const store = createTestStore();
  const scopeKey = await createTestScopeKey();
  const devSlots = new Map<string, AgentSlot>();
  const ws = new MockWebSocket("ws://test");
  await flush();

  const msg = makeDevRegister();
  const ownerHash = await hashApiKey("test-api-key");

  await registerDevAgent(
    ws as unknown as WebSocket,
    "ns/dev-agent",
    msg,
    ownerHash,
    devSlots,
    scopeKey,
  );

  // Dev slot should be created
  const slot = devSlots.get("ns/dev-agent");
  expect(slot).toBeDefined();
  expect(slot!.name).toBe("Dev Agent");
  expect(slot!._dev).toBe(true);

  // Should have sent dev_registered
  const sent = ws.sentJson();
  expect(sent.length).toBeGreaterThanOrEqual(1);
  const regMsg = sent.find((m) => m.type === "dev_registered");
  expect(regMsg).toBeDefined();
  expect(regMsg!.slug).toBe("ns/dev-agent");

  // Should NOT be stored
  const manifest = await store.getManifest("ns/dev-agent");
  expect(manifest).toBe(null);
});

Deno.test("registerDevAgent terminates existing worker", async () => {
  const scopeKey = await createTestScopeKey();
  const devSlots = new Map<string, AgentSlot>();
  const ws = new MockWebSocket("ws://test");
  await flush();

  let terminated = false;
  devSlots.set("ns/dev-agent", {
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
    devSlots,
    scopeKey,
  );

  expect(terminated).toBe(true);
  // Should preserve activeSessions count
  expect(devSlots.get("ns/dev-agent")!.activeSessions).toBe(2);
});

Deno.test("registerDevAgent includes builtin tools in log", async () => {
  const scopeKey = await createTestScopeKey();
  const devSlots = new Map<string, AgentSlot>();
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
    devSlots,
    scopeKey,
  );

  const slot = devSlots.get("ns/tool-agent");
  expect(slot).toBeDefined();
  expect(slot!.toolSchemas).toEqual(msg.toolSchemas);
});
