import { expect } from "@std/expect";
import {
  AgentMetadataSchema,
  RpcRequestSchema,
  RpcResponseSchema,
} from "./_rpc_schema.ts";

Deno.test("RpcRequestSchema", async (t) => {
  await t.step("accepts executeTool", () => {
    const result = RpcRequestSchema.safeParse({
      id: 1,
      type: "executeTool",
      name: "greet",
      args: { name: "world" },
    });
    expect(result.success).toBe(true);
  });

  await t.step("accepts executeTool with sessionId", () => {
    const result = RpcRequestSchema.safeParse({
      id: 1,
      type: "executeTool",
      name: "greet",
      args: {},
      sessionId: "sess-1",
    });
    expect(result.success).toBe(true);
  });

  await t.step("accepts invokeHook", () => {
    const result = RpcRequestSchema.safeParse({
      id: 2,
      type: "invokeHook",
      hook: "onConnect",
      sessionId: "sess-1",
    });
    expect(result.success).toBe(true);
  });

  await t.step("accepts invokeHook with text and error", () => {
    const result = RpcRequestSchema.safeParse({
      id: 2,
      type: "invokeHook",
      hook: "onTurn",
      sessionId: "sess-1",
      text: "hello",
      error: "oops",
    });
    expect(result.success).toBe(true);
  });

  await t.step("rejects invalid hook name", () => {
    const result = RpcRequestSchema.safeParse({
      id: 2,
      type: "invokeHook",
      hook: "onInvalid",
      sessionId: "sess-1",
    });
    expect(result.success).toBe(false);
  });

  await t.step("accepts execute", () => {
    const result = RpcRequestSchema.safeParse({
      id: 3,
      type: "execute",
      code: "console.log('hi')",
    });
    expect(result.success).toBe(true);
  });

  await t.step("rejects unknown type", () => {
    const result = RpcRequestSchema.safeParse({
      id: 4,
      type: "unknown",
    });
    expect(result.success).toBe(false);
  });

  await t.step("rejects missing id", () => {
    const result = RpcRequestSchema.safeParse({
      type: "execute",
      code: "hi",
    });
    expect(result.success).toBe(false);
  });
});

Deno.test("RpcResponseSchema", async (t) => {
  await t.step("accepts result response", () => {
    const result = RpcResponseSchema.safeParse({
      id: 1,
      result: { data: "hello" },
    });
    expect(result.success).toBe(true);
  });

  await t.step("accepts error response", () => {
    const result = RpcResponseSchema.safeParse({
      id: 1,
      error: "something went wrong",
    });
    expect(result.success).toBe(true);
  });

  await t.step("rejects missing id", () => {
    const result = RpcResponseSchema.safeParse({ result: "hi" });
    expect(result.success).toBe(false);
  });
});

Deno.test("AgentMetadataSchema", async (t) => {
  await t.step("accepts minimal metadata", () => {
    const result = AgentMetadataSchema.safeParse({ slug: "test" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.env).toEqual({});
      expect(result.data.transport).toEqual(["websocket"]);
    }
  });

  await t.step("accepts full metadata", () => {
    const result = AgentMetadataSchema.safeParse({
      slug: "my-agent",
      env: { KEY: "val" },
      transport: ["websocket", "twilio"],
      owner_hash: "abc123",
      config: {
        instructions: "Help",
        greeting: "Hi",
        voice: "luna",
      },
      toolSchemas: [
        { name: "greet", description: "Say hi", parameters: {} },
      ],
    });
    expect(result.success).toBe(true);
  });

  await t.step("rejects missing slug", () => {
    const result = AgentMetadataSchema.safeParse({ env: {} });
    expect(result.success).toBe(false);
  });
});
