import { expect } from "@std/expect";
import {
  type AgentSlot,
  registerSlot,
  trackSessionClose,
  trackSessionOpen,
} from "./worker_pool.ts";
import type { WorkerApi } from "@aai/core/worker-entry";
import { createRpcCaller } from "@aai/core/rpc";
import { VALID_ENV } from "./_test_utils.ts";

function makeSlot(overrides?: Partial<AgentSlot>): AgentSlot {
  return {
    slug: "test",
    env: VALID_ENV,
    transport: ["websocket"],
    activeSessions: 0,
    ...overrides,
  };
}

// --- registerSlot ---

Deno.test("registerSlot with valid env", () => {
  const slots = new Map<string, AgentSlot>();
  const ok = registerSlot(slots, {
    slug: "hello",
    env: VALID_ENV,
    transport: ["websocket"],
  });
  expect(ok).toBe(true);
  expect(slots.has("hello")).toBe(true);
  expect(slots.get("hello")!.activeSessions).toBe(0);
});

Deno.test("registerSlot returns false for invalid env", () => {
  const slots = new Map<string, AgentSlot>();
  const ok = registerSlot(slots, {
    slug: "bad",
    env: {},
    transport: ["websocket"],
  });
  expect(ok).toBe(false);
  expect(slots.has("bad")).toBe(false);
});

Deno.test("registerSlot overwrites existing slot", () => {
  const slots = new Map<string, AgentSlot>();
  registerSlot(slots, { slug: "x", env: VALID_ENV, transport: ["websocket"] });
  registerSlot(slots, { slug: "x", env: VALID_ENV, transport: ["websocket"] });
  expect(slots.size).toBe(1);
});

// --- trackSessionOpen ---

Deno.test("trackSessionOpen increments activeSessions", () => {
  const slot = makeSlot();
  trackSessionOpen(slot);
  expect(slot.activeSessions).toBe(1);
  trackSessionOpen(slot);
  expect(slot.activeSessions).toBe(2);
});

Deno.test("trackSessionOpen clears idle timer", () => {
  const slot = makeSlot({ idleTimer: setTimeout(() => {}, 99999) });
  trackSessionOpen(slot);
  expect(slot.idleTimer).toBeUndefined();
});

// --- trackSessionClose ---

Deno.test("trackSessionClose decrements activeSessions", () => {
  const slot = makeSlot({ activeSessions: 2 });
  trackSessionClose(slot);
  expect(slot.activeSessions).toBe(1);
});

Deno.test("trackSessionClose does not go below zero", () => {
  const slot = makeSlot({ activeSessions: 0 });
  trackSessionClose(slot);
  expect(slot.activeSessions).toBe(0);
});

Deno.test("trackSessionClose sets idle timer when last session closes and agent is live", () => {
  const slot = makeSlot({
    activeSessions: 1,
    worker: {
      handle: { terminate() {} },
      api: {} as WorkerApi,
    },
  });
  trackSessionClose(slot);
  expect(slot.idleTimer).toBeDefined();
  clearTimeout(slot.idleTimer);
});

Deno.test("trackSessionClose does not set idle timer when no live agent", () => {
  const slot = makeSlot({ activeSessions: 1 });
  trackSessionClose(slot);
  expect(slot.idleTimer).toBeUndefined();
});

// --- createRpcCaller ---

function echoServer(port: MessagePort): void {
  port.onmessage = (e: MessageEvent) => {
    const msg = e.data;
    port.postMessage({ id: msg.id, result: { type: msg.type, ...msg } });
  };
}

Deno.test("createRpcCaller sends message and resolves with result", async () => {
  const { port1, port2 } = new MessageChannel();
  echoServer(port2);
  const call = createRpcCaller(port1);
  const result = await call("ping");
  expect((result as Record<string, unknown>).type).toBe("ping");
  port1.close();
  port2.close();
});

Deno.test("createRpcCaller passes payload fields in message", async () => {
  const { port1, port2 } = new MessageChannel();
  echoServer(port2);
  const call = createRpcCaller(port1);
  const result = await call("test", { foo: "bar" }) as Record<string, unknown>;
  expect(result.foo).toBe("bar");
  port1.close();
  port2.close();
});

Deno.test("createRpcCaller rejects on error response", async () => {
  const { port1, port2 } = new MessageChannel();
  port2.onmessage = (e: MessageEvent) => {
    port2.postMessage({ id: e.data.id, error: "boom" });
  };
  const call = createRpcCaller(port1);
  await expect(call("fail")).rejects.toThrow("boom");
  port1.close();
  port2.close();
});

Deno.test("createRpcCaller rejects on timeout", async () => {
  const { port1, port2 } = new MessageChannel();
  const call = createRpcCaller(port1);
  await expect(call("slow", undefined, 50)).rejects.toThrow("timed out");
  port1.close();
  port2.close();
});
