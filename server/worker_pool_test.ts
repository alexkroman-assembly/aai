import { expect } from "@std/expect";
import {
  type AgentSlot,
  createRpcCall,
  registerSlot,
  trackSessionClose,
  trackSessionOpen,
} from "./worker_pool.ts";
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

Deno.test("registerSlot", async (t) => {
  await t.step("registers slot with valid env", () => {
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

  await t.step("returns false for invalid env", () => {
    const slots = new Map<string, AgentSlot>();
    const ok = registerSlot(slots, {
      slug: "bad",
      env: {},
      transport: ["websocket"],
    });
    expect(ok).toBe(false);
    expect(slots.has("bad")).toBe(false);
  });

  await t.step("overwrites existing slot with same slug", () => {
    const slots = new Map<string, AgentSlot>();
    registerSlot(slots, {
      slug: "x",
      env: VALID_ENV,
      transport: ["websocket"],
    });
    registerSlot(slots, {
      slug: "x",
      env: VALID_ENV,
      transport: ["websocket"],
    });
    expect(slots.size).toBe(1);
  });
});

Deno.test("trackSessionOpen", async (t) => {
  await t.step("increments activeSessions", () => {
    const slot = makeSlot();
    trackSessionOpen(slot);
    expect(slot.activeSessions).toBe(1);
    trackSessionOpen(slot);
    expect(slot.activeSessions).toBe(2);
  });

  await t.step("clears idle timer", () => {
    const slot = makeSlot({ idleTimer: setTimeout(() => {}, 99999) });
    trackSessionOpen(slot);
    expect(slot.idleTimer).toBeUndefined();
  });
});

Deno.test("trackSessionClose", async (t) => {
  await t.step("decrements activeSessions", () => {
    const slot = makeSlot({ activeSessions: 2 });
    trackSessionClose(slot);
    expect(slot.activeSessions).toBe(1);
  });

  await t.step("does not go below zero", () => {
    const slot = makeSlot({ activeSessions: 0 });
    trackSessionClose(slot);
    expect(slot.activeSessions).toBe(0);
  });

  await t.step(
    "sets idle timer when last session closes and agent is live",
    () => {
      const slot = makeSlot({
        activeSessions: 1,
        live: {
          slug: "test",
          name: "test",
          worker: { terminate() {} },
          workerApi: {} as unknown,
          config: {} as unknown,
          toolSchemas: [],
        } as AgentSlot["live"],
      });
      trackSessionClose(slot);
      expect(slot.idleTimer).toBeDefined();
      // Clean up the timer
      clearTimeout(slot.idleTimer);
    },
  );

  await t.step("does not set idle timer when no live agent", () => {
    const slot = makeSlot({ activeSessions: 1 });
    trackSessionClose(slot);
    expect(slot.idleTimer).toBeUndefined();
  });
});

Deno.test("createRpcCall", async (t) => {
  function echoServer(port: MessagePort): void {
    port.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      port.postMessage({ id: msg.id, result: { type: msg.type, ...msg } });
    };
  }

  await t.step("sends message and resolves with result", async () => {
    const { port1, port2 } = new MessageChannel();
    echoServer(port2);
    const call = createRpcCall(port1);

    const result = await call("ping");
    expect((result as Record<string, unknown>).type).toBe("ping");

    port1.close();
    port2.close();
  });

  await t.step("passes payload fields in message", async () => {
    const { port1, port2 } = new MessageChannel();
    echoServer(port2);
    const call = createRpcCall(port1);

    const result = await call("test", { foo: "bar" }) as Record<
      string,
      unknown
    >;
    expect(result.foo).toBe("bar");
    expect(result.type).toBe("test");

    port1.close();
    port2.close();
  });

  await t.step("rejects on error response", async () => {
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = (e: MessageEvent) => {
      port2.postMessage({ id: e.data.id, error: "boom" });
    };
    const call = createRpcCall(port1);

    await expect(call("fail")).rejects.toThrow("boom");

    port1.close();
    port2.close();
  });

  await t.step("rejects on timeout", async () => {
    const { port1, port2 } = new MessageChannel();
    // No response handler — message goes unanswered
    const call = createRpcCall(port1);

    await expect(call("slow", undefined, 50)).rejects.toThrow("timed out");

    port1.close();
    port2.close();
  });
});
