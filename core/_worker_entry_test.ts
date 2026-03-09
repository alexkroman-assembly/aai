import { expect } from "@std/expect";
import { z } from "zod";
import {
  executeToolCall,
  startWorker,
  TOOL_HANDLER_TIMEOUT,
} from "./_worker_entry.ts";
import type { MessageTarget } from "./_rpc.ts";
import type { ToolDef } from "@aai/sdk/types";

function makeTool(
  execute: ToolDef["execute"],
  params?: ToolDef["parameters"],
): ToolDef {
  return { description: "test tool", parameters: params, execute };
}

Deno.test("executeToolCall", async (t) => {
  await t.step("calls execute and returns string result", async () => {
    const tool = makeTool(() => "hello");
    const result = await executeToolCall("greet", {}, tool, {});
    expect(result).toBe("hello");
  });

  await t.step("returns JSON for non-string result", async () => {
    const tool = makeTool(() => ({ key: "value" }));
    const result = await executeToolCall("data", {}, tool, {});
    expect(result).toBe('{"key":"value"}');
  });

  await t.step("returns 'null' for null result", async () => {
    const tool = makeTool(() => null);
    const result = await executeToolCall("noop", {}, tool, {});
    expect(result).toBe("null");
  });

  await t.step("validates args against schema", async () => {
    const tool = makeTool(
      (args) => `Hello ${args.name}`,
      z.object({ name: z.string() }),
    );
    const result = await executeToolCall("greet", { name: 42 }, tool, {});
    expect(result).toContain("Error: Invalid arguments");
    expect(result).toContain("greet");
  });

  await t.step("passes valid args through schema", async () => {
    const tool = makeTool(
      (args) => `Hello ${args.name}`,
      z.object({ name: z.string() }),
    );
    const result = await executeToolCall("greet", { name: "world" }, tool, {});
    expect(result).toBe("Hello world");
  });

  await t.step("catches execution errors", async () => {
    const tool = makeTool(() => {
      throw new Error("boom");
    });
    const result = await executeToolCall("fail", {}, tool, {});
    expect(result).toBe("Error: boom");
  });

  await t.step("passes env and sessionId in context", async () => {
    let capturedCtx: unknown;
    const tool = makeTool((_args, ctx) => {
      capturedCtx = ctx;
      return "ok";
    });
    await executeToolCall("t", {}, tool, { KEY: "val" }, "sess-1");
    const ctx = capturedCtx as {
      env: Record<string, string>;
      sessionId: string;
    };
    expect(ctx.env).toEqual({ KEY: "val" });
    expect(ctx.sessionId).toBe("sess-1");
  });

  await t.step("passes state in context", async () => {
    let capturedState: unknown;
    const tool = makeTool((_args, ctx) => {
      capturedState = ctx.state;
      return "ok";
    });
    const state = { count: 5 };
    await executeToolCall("t", {}, tool, {}, undefined, state);
    expect(capturedState).toEqual({ count: 5 });
  });
});

Deno.test("TOOL_HANDLER_TIMEOUT", () => {
  expect(TOOL_HANDLER_TIMEOUT).toBe(30_000);
});

Deno.test("startWorker", async (t) => {
  function createMockPort(): MessageTarget & { sent: unknown[] } {
    return {
      onmessage: null,
      sent: [] as unknown[],
      postMessage(message: unknown) {
        this.sent.push(message);
      },
    };
  }

  function dispatch(target: MessageTarget, data: unknown) {
    target.onmessage?.({ data } as MessageEvent);
  }

  await t.step("handles executeTool RPC", async () => {
    const port = createMockPort();
    startWorker(
      {
        name: "Test",
        env: [],
        transport: ["websocket"],
        instructions: "",
        greeting: "",
        voice: "luna",
        tools: {
          greet: {
            description: "Say hi",
            execute: () => "hello",
          },
        },
      },
      { KEY: "val" },
      port,
    );

    dispatch(port, {
      id: 1,
      type: "executeTool",
      name: "greet",
      args: {},
      sessionId: "s1",
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(port.sent).toEqual([{ id: 1, result: "hello" }]);
  });

  await t.step("returns error for unknown tool", async () => {
    const port = createMockPort();
    startWorker(
      {
        name: "Test",
        env: [],
        transport: ["websocket"],
        instructions: "",
        greeting: "",
        voice: "luna",
        tools: {},
      },
      {},
      port,
    );

    dispatch(port, {
      id: 2,
      type: "executeTool",
      name: "missing",
      args: {},
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(port.sent).toEqual([
      { id: 2, result: 'Error: Unknown tool "missing"' },
    ]);
  });

  await t.step("handles invokeHook for onConnect", async () => {
    const port = createMockPort();
    let connected = false;
    startWorker(
      {
        name: "Test",
        env: [],
        transport: ["websocket"],
        instructions: "",
        greeting: "",
        voice: "luna",
        tools: {},
        onConnect: () => {
          connected = true;
        },
      },
      {},
      port,
    );

    dispatch(port, {
      id: 3,
      type: "invokeHook",
      hook: "onConnect",
      sessionId: "s1",
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(connected).toBe(true);
  });

  await t.step("initializes per-session state", async () => {
    const port = createMockPort();
    let capturedState: unknown;
    startWorker(
      {
        name: "Test",
        env: [],
        transport: ["websocket"],
        instructions: "",
        greeting: "",
        voice: "luna",
        tools: {
          check: {
            description: "check state",
            execute: (_args, ctx) => {
              capturedState = ctx.state;
              return "ok";
            },
          },
        },
        state: () => ({ count: 0 }),
      },
      {},
      port,
    );

    dispatch(port, {
      id: 1,
      type: "executeTool",
      name: "check",
      args: {},
      sessionId: "s1",
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(capturedState).toEqual({ count: 0 });
  });

  await t.step("cleans up session state on onDisconnect", async () => {
    const port = createMockPort();
    const states: unknown[] = [];
    startWorker(
      {
        name: "Test",
        env: [],
        transport: ["websocket"],
        instructions: "",
        greeting: "",
        voice: "luna",
        tools: {
          check: {
            description: "check state",
            execute: (_args, ctx) => {
              states.push({ ...ctx.state as Record<string, unknown> });
              return "ok";
            },
          },
        },
        state: () => ({ count: 0 }),
        onDisconnect: () => {},
      },
      {},
      port,
    );

    // Create state for session
    dispatch(port, {
      id: 1,
      type: "executeTool",
      name: "check",
      args: {},
      sessionId: "s1",
    });
    await new Promise((r) => setTimeout(r, 10));

    // Disconnect session
    dispatch(port, {
      id: 2,
      type: "invokeHook",
      hook: "onDisconnect",
      sessionId: "s1",
    });
    await new Promise((r) => setTimeout(r, 10));

    // New tool call should get fresh state
    dispatch(port, {
      id: 3,
      type: "executeTool",
      name: "check",
      args: {},
      sessionId: "s1",
    });
    await new Promise((r) => setTimeout(r, 10));

    // Both should have count: 0 because state was re-created
    expect(states).toEqual([{ count: 0 }, { count: 0 }]);
  });
});
