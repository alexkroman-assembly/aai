import { expect } from "@std/expect";
import { ClientMessageSchema } from "./protocol.ts";
import { LLMResponseSchema, SttMessageSchema } from "./types.ts";

Deno.test("SttMessageSchema", async (t) => {
  await t.step("validates a Transcript message", () => {
    const result = SttMessageSchema.safeParse({
      type: "Transcript",
      transcript: "hello",
      is_final: false,
    });
    expect(result.success).toBe(true);
  });

  await t.step("validates a Turn message", () => {
    const result = SttMessageSchema.safeParse({
      type: "Turn",
      transcript: "hello world",
      turn_is_formatted: true,
    });
    expect(result.success).toBe(true);
  });

  await t.step("allows passthrough of extra fields", () => {
    const result = SttMessageSchema.safeParse({
      type: "Transcript",
      transcript: "hi",
      extra_field: 42,
    });
    expect(result.success).toBe(true);
  });

  await t.step("rejects when type is missing", () => {
    const result = SttMessageSchema.safeParse({ transcript: "hi" });
    expect(result.success).toBe(false);
  });

  await t.step("rejects when type is not a string", () => {
    const result = SttMessageSchema.safeParse({ type: 123 });
    expect(result.success).toBe(false);
  });
});

Deno.test("ClientMessageSchema", async (t) => {
  await t.step("validates audio_ready", () => {
    const result = ClientMessageSchema.safeParse({ type: "audio_ready" });
    expect(result.success).toBe(true);
  });

  await t.step("validates cancel", () => {
    const result = ClientMessageSchema.safeParse({ type: "cancel" });
    expect(result.success).toBe(true);
  });

  await t.step("validates reset", () => {
    const result = ClientMessageSchema.safeParse({ type: "reset" });
    expect(result.success).toBe(true);
  });

  await t.step("validates ping", () => {
    const result = ClientMessageSchema.safeParse({ type: "ping" });
    expect(result.success).toBe(true);
  });

  await t.step("validates history", () => {
    const result = ClientMessageSchema.safeParse({
      type: "history",
      messages: [{ role: "user", text: "hello" }],
    });
    expect(result.success).toBe(true);
  });

  await t.step("rejects unknown type", () => {
    const result = ClientMessageSchema.safeParse({ type: "unknown" });
    expect(result.success).toBe(false);
  });

  await t.step("rejects missing type", () => {
    const result = ClientMessageSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

Deno.test("LLMResponseSchema", async (t) => {
  await t.step("validates a complete response", () => {
    const result = LLMResponseSchema.safeParse({
      id: "chatcmpl-123",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello!" },
          finish_reason: "stop",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  await t.step("validates a response with tool_calls", () => {
    const result = LLMResponseSchema.safeParse({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "get_weather", arguments: '{"city":"NYC"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  await t.step("rejects when choices is missing", () => {
    const result = LLMResponseSchema.safeParse({ id: "test" });
    expect(result.success).toBe(false);
  });

  await t.step("rejects when message is missing from choice", () => {
    const result = LLMResponseSchema.safeParse({
      choices: [{ finish_reason: "stop" }],
    });
    expect(result.success).toBe(false);
  });
});
