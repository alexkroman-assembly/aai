// Copyright 2025 the AAI authors. MIT license.
import { assertEquals, assertStrictEquals } from "@std/assert";
import {
  AgentConfigSchema,
  AgentMetadataSchema,
  ClientMessageSchema,
  DeployBodySchema,
  EnvSchema,
  ServerMessageSchema,
  ToolSchemaSchema,
} from "./_schemas.ts";

Deno.test("AgentConfigSchema", async (t) => {
  await t.step("accepts minimal config", () => {
    const result = AgentConfigSchema.safeParse({
      name: "Test",
      instructions: "Help",
      greeting: "Hi",
      voice: "luna",
    });
    assertStrictEquals(result.success, true);
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
    assertStrictEquals(result.success, true);
  });

  await t.step("rejects missing required fields", () => {
    assertStrictEquals(AgentConfigSchema.safeParse({}).success, false);
    assertStrictEquals(
      AgentConfigSchema.safeParse({ instructions: "x" }).success,
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
    assertStrictEquals(result.success, true);
  });

  await t.step("rejects missing name", () => {
    const result = ToolSchemaSchema.safeParse({
      description: "Say hi",
      parameters: { type: "object" },
    });
    assertStrictEquals(result.success, false);
  });

  await t.step("rejects parameters without type: object", () => {
    const result = ToolSchemaSchema.safeParse({
      name: "greet",
      description: "Say hi",
      parameters: { type: "string" },
    });
    assertStrictEquals(result.success, false);
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
    assertStrictEquals(result.success, true);
  });
});

Deno.test("DeployBodySchema", async (t) => {
  await t.step("accepts valid deploy body", () => {
    const result = DeployBodySchema.safeParse({
      env: { ASSEMBLYAI_API_KEY: "test" },
      worker: "code",
      html: "<html></html>",
    });
    assertStrictEquals(result.success, true);
  });

  await t.step("rejects empty worker", () => {
    const result = DeployBodySchema.safeParse({
      env: {},
      worker: "",
      html: "<html></html>",
    });
    assertStrictEquals(result.success, false);
  });

  await t.step("accepts transport as array", () => {
    const result = DeployBodySchema.safeParse({
      env: {},
      worker: "code",
      html: "<html></html>",
      transport: ["websocket", "twilio"],
    });
    assertStrictEquals(result.success, true);
  });

  await t.step("rejects transport as bare string", () => {
    const result = DeployBodySchema.safeParse({
      env: {},
      worker: "code",
      html: "<html></html>",
      transport: "twilio",
    });
    assertStrictEquals(result.success, false);
  });
});

Deno.test("EnvSchema", async (t) => {
  await t.step("accepts valid env", () => {
    const result = EnvSchema.safeParse({ ASSEMBLYAI_API_KEY: "key123" });
    assertStrictEquals(result.success, true);
  });

  await t.step("rejects empty ASSEMBLYAI_API_KEY", () => {
    const result = EnvSchema.safeParse({ ASSEMBLYAI_API_KEY: "" });
    assertStrictEquals(result.success, false);
  });

  await t.step("allows extra keys via passthrough", () => {
    const result = EnvSchema.safeParse({
      ASSEMBLYAI_API_KEY: "key",
      CUSTOM: "val",
    });
    assertStrictEquals(result.success, true);
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
      assertStrictEquals(ServerMessageSchema.safeParse(msg).success, true);
    });
  }

  await t.step("rejects unknown type", () => {
    assertStrictEquals(
      ServerMessageSchema.safeParse({ type: "unknown" }).success,
      false,
    );
  });
});

Deno.test("ClientMessageSchema", async (t) => {
  for (const type of ["audio_ready", "cancel", "reset", "ping"]) {
    await t.step(`accepts ${type}`, () => {
      assertStrictEquals(
        ClientMessageSchema.safeParse({ type }).success,
        true,
      );
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
    assertStrictEquals(result.success, true);
  });

  await t.step("rejects history with invalid role", () => {
    const result = ClientMessageSchema.safeParse({
      type: "history",
      messages: [{ role: "system", text: "hello" }],
    });
    assertStrictEquals(result.success, false);
  });
});

Deno.test("AgentMetadataSchema", async (t) => {
  await t.step("accepts minimal metadata", () => {
    const result = AgentMetadataSchema.safeParse({ slug: "test" });
    assertStrictEquals(result.success, true);
    if (result.success) {
      assertEquals(result.data.env, {});
      assertEquals(result.data.transport, ["websocket"]);
    }
  });

  await t.step("accepts full metadata", () => {
    const result = AgentMetadataSchema.safeParse({
      slug: "my-agent",
      env: { KEY: "val" },
      transport: ["websocket", "twilio"],
      credential_hashes: ["abc123"],
    });
    assertStrictEquals(result.success, true);
  });

  await t.step("rejects missing slug", () => {
    const result = AgentMetadataSchema.safeParse({ env: {} });
    assertStrictEquals(result.success, false);
  });
});
