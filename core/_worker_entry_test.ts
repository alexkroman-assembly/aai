import { expect } from "@std/expect";
import { z } from "zod";
import {
  createWorkerApi,
  executeToolCall,
  type HostApi,
  startWorker,
  TOOL_HANDLER_TIMEOUT,
} from "./_worker_entry.ts";
import type { ToolDef } from "@aai/sdk/types";

function makeTool(
  execute: ToolDef["execute"],
  params?: ToolDef["parameters"],
): ToolDef {
  return { description: "test tool", parameters: params, execute };
}

function dummyHostApi(): HostApi {
  return {
    fetch() {
      return Promise.resolve({
        status: 200,
        statusText: "OK",
        headers: {},
        body: "",
      });
    },
    kv() {
      return Promise.resolve({ result: null });
    },
  };
}

function hostApi(overrides?: Partial<HostApi>): HostApi {
  return { ...dummyHostApi(), ...overrides };
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

Deno.test("startWorker via Comlink", async (t) => {
  await t.step("handles executeTool", async () => {
    const { port1, port2 } = new MessageChannel();
    startWorker(
      {
        name: "Test",
        mode: "full" as const,
        env: [],
        transport: ["websocket"],
        instructions: "",
        greeting: "",
        voice: "luna",
        maxSteps: 5,
        tools: {
          greet: {
            description: "Say hi",
            execute: () => "hello",
          },
        },
      },
      { KEY: "val" },
      port1,
    );

    const api = createWorkerApi(port2);
    const result = await api.executeTool("greet", {}, "s1", 5000);
    expect(result).toBe("hello");
    await api.dispose?.();
    port1.close();
    port2.close();
  });

  await t.step("returns error for unknown tool", async () => {
    const { port1, port2 } = new MessageChannel();
    startWorker(
      {
        name: "Test",
        mode: "full" as const,
        env: [],
        transport: ["websocket"],
        instructions: "",
        greeting: "",
        voice: "luna",
        maxSteps: 5,
        tools: {},
      },
      {},
      port1,
    );

    const api = createWorkerApi(port2);
    const result = await api.executeTool("missing", {}, undefined, 5000);
    expect(result).toContain('Unknown tool "missing"');
    await api.dispose?.();
    port1.close();
    port2.close();
  });

  await t.step("handles invokeHook for onConnect", async () => {
    const { port1, port2 } = new MessageChannel();
    let connected = false;
    startWorker(
      {
        name: "Test",
        mode: "full" as const,
        env: [],
        transport: ["websocket"],
        instructions: "",
        greeting: "",
        voice: "luna",
        maxSteps: 5,
        tools: {},
        onConnect: () => {
          connected = true;
        },
      },
      {},
      port1,
    );

    const api = createWorkerApi(port2);
    await api.invokeHook("onConnect", "s1", undefined, 5000);
    expect(connected).toBe(true);
    await api.dispose?.();
    port1.close();
    port2.close();
  });

  await t.step("initializes per-session state", async () => {
    const { port1, port2 } = new MessageChannel();
    let capturedState: unknown;
    startWorker(
      {
        name: "Test",
        mode: "full" as const,
        env: [],
        transport: ["websocket"],
        instructions: "",
        greeting: "",
        voice: "luna",
        maxSteps: 5,
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
      port1,
    );

    const api = createWorkerApi(port2, dummyHostApi());
    await api.executeTool("check", {}, "s1", 5000);
    expect(capturedState).toEqual({ count: 0 });
    await api.dispose?.();
    port1.close();
    port2.close();
  });

  await t.step("cleans up session state on onDisconnect", async () => {
    const { port1, port2 } = new MessageChannel();
    const states: unknown[] = [];
    startWorker(
      {
        name: "Test",
        mode: "full" as const,
        env: [],
        transport: ["websocket"],
        instructions: "",
        greeting: "",
        voice: "luna",
        maxSteps: 5,
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
      port1,
    );

    const api = createWorkerApi(port2, dummyHostApi());

    // Create state for session
    await api.executeTool("check", {}, "s1", 5000);

    // Disconnect session
    await api.invokeHook("onDisconnect", "s1", undefined, 5000);

    // New tool call should get fresh state
    await api.executeTool("check", {}, "s1", 5000);

    // Both should have count: 0 because state was re-created
    expect(states).toEqual([{ count: 0 }, { count: 0 }]);
    await api.dispose?.();
    port1.close();
    port2.close();
  });
});

Deno.test("fetch proxy via Comlink", async (t) => {
  await t.step(
    "worker fetch proxies through host via Comlink",
    async () => {
      const { port1, port2 } = new MessageChannel();

      let capturedFetch: typeof globalThis.fetch | undefined;
      startWorker(
        {
          name: "Test",
          mode: "full" as const,
          env: [],
          transport: ["websocket"],
          instructions: "",
          greeting: "",
          voice: "luna",
          maxSteps: 5,
          tools: {
            do_fetch: {
              description: "fetch something",
              execute: async () => {
                capturedFetch = globalThis.fetch;
                const resp = await globalThis.fetch(
                  "https://api.example.com/data",
                );
                return await resp.text();
              },
            },
          },
        },
        {},
        port1,
      );

      const api = createWorkerApi(
        port2,
        hostApi({
          fetch(req) {
            return Promise.resolve({
              status: 200,
              statusText: "OK",
              headers: { "content-type": "application/json" },
              body: `{"proxied":"${req.url}"}`,
            });
          },
        }),
      );

      const result = await api.executeTool("do_fetch", {}, "s1", 5000);
      expect(result).toBe('{"proxied":"https://api.example.com/data"}');
      expect(capturedFetch).toBeDefined();
      expect(capturedFetch).not.toBe(undefined);
      await api.dispose?.();
      port1.close();
      port2.close();
    },
  );

  await t.step(
    "fetch proxy returns proper Response object",
    async () => {
      const { port1, port2 } = new MessageChannel();

      let capturedStatus: number | undefined;
      let capturedHeaders: string | undefined;

      startWorker(
        {
          name: "Test",
          mode: "full" as const,
          env: [],
          transport: ["websocket"],
          instructions: "",
          greeting: "",
          voice: "luna",
          maxSteps: 5,
          tools: {
            check_response: {
              description: "check response properties",
              execute: async () => {
                const resp = await globalThis.fetch(
                  "https://example.com",
                );
                capturedStatus = resp.status;
                capturedHeaders = resp.headers.get("x-custom") ?? undefined;
                return `${resp.status} ${resp.statusText}`;
              },
            },
          },
        },
        {},
        port1,
      );

      const api = createWorkerApi(
        port2,
        hostApi({
          fetch() {
            return Promise.resolve({
              status: 201,
              statusText: "Created",
              headers: { "x-custom": "test-value" },
              body: "",
            });
          },
        }),
      );

      const result = await api.executeTool(
        "check_response",
        {},
        "s1",
        5000,
      );
      expect(result).toBe("201 Created");
      expect(capturedStatus).toBe(201);
      expect(capturedHeaders).toBe("test-value");
      await api.dispose?.();
      port1.close();
      port2.close();
    },
  );

  await t.step(
    "fetch proxy propagates host errors",
    async () => {
      const { port1, port2 } = new MessageChannel();

      startWorker(
        {
          name: "Test",
          mode: "full" as const,
          env: [],
          transport: ["websocket"],
          instructions: "",
          greeting: "",
          voice: "luna",
          maxSteps: 5,
          tools: {
            bad_fetch: {
              description: "fetch blocked URL",
              execute: async () => {
                await globalThis.fetch("http://169.254.169.254/metadata");
                return "should not reach";
              },
            },
          },
        },
        {},
        port1,
      );

      const api = createWorkerApi(
        port2,
        hostApi({
          fetch() {
            return Promise.reject(
              new Error(
                "Blocked request to private address: 169.254.169.254",
              ),
            );
          },
        }),
      );

      const result = await api.executeTool(
        "bad_fetch",
        {},
        "s1",
        5000,
      );
      expect(result).toContain("Blocked request to private address");
      await api.dispose?.();
      port1.close();
      port2.close();
    },
  );

  await t.step(
    "fetch proxy sends method and headers",
    async () => {
      const { port1, port2 } = new MessageChannel();
      let capturedMethod: string | undefined;
      let capturedHeaders: Record<string, string> | undefined;
      let capturedBody: string | null | undefined;

      startWorker(
        {
          name: "Test",
          mode: "full" as const,
          env: [],
          transport: ["websocket"],
          instructions: "",
          greeting: "",
          voice: "luna",
          maxSteps: 5,
          tools: {
            post_data: {
              description: "POST some data",
              execute: async () => {
                const resp = await globalThis.fetch("https://api.example.com", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: '{"hello":"world"}',
                });
                return await resp.text();
              },
            },
          },
        },
        {},
        port1,
      );

      const api = createWorkerApi(
        port2,
        hostApi({
          fetch(req) {
            capturedMethod = req.method;
            capturedHeaders = req.headers;
            capturedBody = req.body;
            return Promise.resolve({
              status: 200,
              statusText: "OK",
              headers: {},
              body: "posted",
            });
          },
        }),
      );

      const result = await api.executeTool(
        "post_data",
        {},
        "s1",
        5000,
      );
      expect(result).toBe("posted");
      expect(capturedMethod).toBe("POST");
      expect(capturedHeaders?.["content-type"]).toBe("application/json");
      expect(capturedBody).toBe('{"hello":"world"}');
      await api.dispose?.();
      port1.close();
      port2.close();
    },
  );
});

Deno.test("createWorkerApi with hostApi", async (t) => {
  await t.step(
    "creates bidirectional communication when hostApi provided",
    async () => {
      const { port1, port2 } = new MessageChannel();
      let fetchCalled = false;
      startWorker(
        {
          name: "Test",
          mode: "full" as const,
          env: [],
          transport: ["websocket"],
          instructions: "",
          greeting: "",
          voice: "luna",
          maxSteps: 5,
          tools: {
            do_fetch: {
              description: "fetch",
              execute: async () => {
                const resp = await globalThis.fetch("https://example.com");
                return await resp.text();
              },
            },
          },
        },
        {},
        port1,
      );

      const api = createWorkerApi(
        port2,
        hostApi({
          fetch() {
            fetchCalled = true;
            return Promise.resolve({
              status: 200,
              statusText: "OK",
              headers: {},
              body: "ok",
            });
          },
        }),
      );

      await api.executeTool("do_fetch", {}, "s1", 5000);
      expect(fetchCalled).toBe(true);
      await api.dispose?.();
      port1.close();
      port2.close();
    },
  );

  await t.step(
    "works without hostApi for tools that don't need fetch/kv",
    async () => {
      const { port1, port2 } = new MessageChannel();
      startWorker(
        {
          name: "Test",
          mode: "full" as const,
          env: [],
          transport: ["websocket"],
          instructions: "",
          greeting: "",
          voice: "luna",
          maxSteps: 5,
          tools: {
            greet: {
              description: "greet",
              execute: () => "hello",
            },
          },
        },
        {},
        port1,
      );

      const api = createWorkerApi(port2);
      const result = await api.executeTool("greet", {}, "s1", 5000);
      expect(result).toBe("hello");
      await api.dispose?.();
      port1.close();
      port2.close();
    },
  );
});
