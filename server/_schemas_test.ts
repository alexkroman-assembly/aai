import { expect } from "@std/expect";
import { normalizeTransport } from "@aai/sdk/schema";
import {
  AgentConfigSchema,
  AgentMetadataSchema,
  ClientMessageSchema,
  DeployBodySchema,
  EnvSchema,
  ServerMessageSchema,
  ToolSchemaSchema,
} from "./_schemas.ts";

Deno.test("normalizeTransport", async (t) => {
  await t.step("defaults to websocket", () => {
    expect(normalizeTransport(undefined)).toEqual(["websocket"]);
  });

  await t.step("wraps string in array", () => {
    expect(normalizeTransport("twilio")).toEqual(["twilio"]);
  });

  await t.step("passes array through", () => {
    expect(normalizeTransport(["websocket", "twilio"])).toEqual([
      "websocket",
      "twilio",
    ]);
  });
});

Deno.test("AgentConfigSchema", async (t) => {
  await t.step("accepts minimal config", () => {
    const result = AgentConfigSchema.safeParse({
      name: "Test",
      instructions: "Help",
      greeting: "Hi",
      voice: "luna",
    });
    expect(result.success).toBe(true);
  });

  await t.step("accepts full config", () => {
    const result = AgentConfigSchema.safeParse({
      name: "Agent",
      instructions: "Help",
      greeting: "Hi",
      voice: "luna",
      sttPrompt: "Transcribe accurately",
      maxSteps: 8,
      builtinTools: ["web_search", "run_code"],
    });
    expect(result.success).toBe(true);
  });

  await t.step("rejects missing required fields", () => {
    expect(AgentConfigSchema.safeParse({}).success).toBe(false);
    expect(AgentConfigSchema.safeParse({ instructions: "x" }).success).toBe(
      false,
    );
  });
});

Deno.test("ToolSchemaSchema", async (t) => {
  await t.step("accepts valid tool schema", () => {
    const result = ToolSchemaSchema.safeParse({
      name: "greet",
      description: "Say hi",
      parameters: { type: "object" },
    });
    expect(result.success).toBe(true);
  });

  await t.step("rejects missing name", () => {
    const result = ToolSchemaSchema.safeParse({
      description: "Say hi",
      parameters: { type: "object" },
    });
    expect(result.success).toBe(false);
  });

  await t.step("rejects parameters without type: object", () => {
    const result = ToolSchemaSchema.safeParse({
      name: "greet",
      description: "Say hi",
      parameters: { type: "string" },
    });
    expect(result.success).toBe(false);
  });

  await t.step("accepts parameters with properties and required", () => {
    const result = ToolSchemaSchema.safeParse({
      name: "greet",
      description: "Say hi",
      parameters: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    });
    expect(result.success).toBe(true);
  });
});

Deno.test("DeployBodySchema", async (t) => {
  await t.step("accepts valid deploy body", () => {
    const result = DeployBodySchema.safeParse({
      env: { ASSEMBLYAI_API_KEY: "test" },
      worker: "code",
      client: "code",
    });
    expect(result.success).toBe(true);
  });

  await t.step("rejects empty worker", () => {
    const result = DeployBodySchema.safeParse({
      env: {},
      worker: "",
      client: "code",
    });
    expect(result.success).toBe(false);
  });

  await t.step("accepts transport as string or array", () => {
    const asString = DeployBodySchema.safeParse({
      env: {},
      worker: "code",
      client: "code",
      transport: "twilio",
    });
    const asArray = DeployBodySchema.safeParse({
      env: {},
      worker: "code",
      client: "code",
      transport: ["websocket", "twilio"],
    });
    expect(asString.success).toBe(true);
    expect(asArray.success).toBe(true);
  });
});

Deno.test("EnvSchema", async (t) => {
  await t.step("accepts valid env", () => {
    const result = EnvSchema.safeParse({ ASSEMBLYAI_API_KEY: "key123" });
    expect(result.success).toBe(true);
  });

  await t.step("rejects empty ASSEMBLYAI_API_KEY", () => {
    const result = EnvSchema.safeParse({ ASSEMBLYAI_API_KEY: "" });
    expect(result.success).toBe(false);
  });

  await t.step("allows extra keys via passthrough", () => {
    const result = EnvSchema.safeParse({
      ASSEMBLYAI_API_KEY: "key",
      CUSTOM: "val",
    });
    expect(result.success).toBe(true);
  });
});

Deno.test("ServerMessageSchema", async (t) => {
  const validMessages: [string, unknown][] = [
    ["ready", {
      type: "ready",
      protocol_version: 1,
      audio_format: "pcm16",
      sample_rate: 16000,
      tts_sample_rate: 24000,
    }],
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
      account_id: "abc123",
    });
    expect(result.success).toBe(true);
  });

  await t.step("rejects missing slug", () => {
    const result = AgentMetadataSchema.safeParse({ env: {} });
    expect(result.success).toBe(false);
  });
});
