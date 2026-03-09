import { expect } from "@std/expect";
import {
  ClientMessageSchema,
  DEFAULT_STT_SAMPLE_RATE,
  DEFAULT_TTS_SAMPLE_RATE,
  DevRegisteredSchema,
  DevRegisterSchema,
  ServerMessageSchema,
} from "./_protocol.ts";

Deno.test("protocol constants", async (t) => {
  await t.step("default sample rates", () => {
    expect(DEFAULT_STT_SAMPLE_RATE).toBe(16_000);
    expect(DEFAULT_TTS_SAMPLE_RATE).toBe(24_000);
  });
});

Deno.test("DevRegisterSchema", async (t) => {
  await t.step("accepts valid message", () => {
    const result = DevRegisterSchema.safeParse({
      type: "dev_register",
      config: {
        instructions: "Be helpful",
        greeting: "Hello",
        voice: "luna",
      },
      toolSchemas: [],
      env: { ASSEMBLYAI_API_KEY: "test" },
      transport: ["websocket"],
      client: "console.log('hi')",
    });
    expect(result.success).toBe(true);
  });

  await t.step("rejects missing fields", () => {
    const result = DevRegisterSchema.safeParse({ type: "dev_register" });
    expect(result.success).toBe(false);
  });
});

Deno.test("DevRegisteredSchema", async (t) => {
  await t.step("accepts valid message", () => {
    const result = DevRegisteredSchema.safeParse({
      type: "dev_registered",
      slug: "my-agent",
    });
    expect(result.success).toBe(true);
  });

  await t.step("rejects missing slug", () => {
    const result = DevRegisteredSchema.safeParse({ type: "dev_registered" });
    expect(result.success).toBe(false);
  });
});

Deno.test("ServerMessageSchema", async (t) => {
  const validMessages: [string, unknown][] = [
    ["ready", { type: "ready", sample_rate: 16000, tts_sample_rate: 24000 }],
    ["partial_transcript", { type: "partial_transcript", text: "hello" }],
    [
      "final_transcript",
      { type: "final_transcript", text: "hello world", turn_order: 1 },
    ],
    ["turn", { type: "turn", text: "response" }],
    ["chat", { type: "chat", text: "hi" }],
    ["tts_done", { type: "tts_done" }],
    ["cancelled", { type: "cancelled" }],
    ["reset", { type: "reset" }],
    [
      "error",
      { type: "error", message: "broke", details: ["detail1", "detail2"] },
    ],
    ["pong", { type: "pong" }],
  ];

  for (const [label, msg] of validMessages) {
    await t.step(`accepts ${label}`, () => {
      expect(ServerMessageSchema.safeParse(msg).success).toBe(true);
    });
  }

  await t.step("rejects unknown type", () => {
    expect(ServerMessageSchema.safeParse({ type: "unknown" }).success).toBe(
      false,
    );
  });
});

Deno.test("ClientMessageSchema", async (t) => {
  for (const type of ["audio_ready", "cancel", "reset", "ping"]) {
    await t.step(`accepts ${type}`, () => {
      expect(ClientMessageSchema.safeParse({ type }).success).toBe(true);
    });
  }

  await t.step("accepts history with messages", () => {
    const result = ClientMessageSchema.safeParse({
      type: "history",
      messages: [
        { role: "user", text: "hello" },
        { role: "assistant", text: "hi" },
      ],
    });
    expect(result.success).toBe(true);
  });

  await t.step("rejects history with invalid role", () => {
    const result = ClientMessageSchema.safeParse({
      type: "history",
      messages: [{ role: "system", text: "hello" }],
    });
    expect(result.success).toBe(false);
  });
});
