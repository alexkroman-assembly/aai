import { expect } from "@std/expect";
import {
  AgentConfigSchema,
  DeployBodySchema,
  EnvSchema,
  normalizeTransport,
  ToolSchemaSchema,
  TransportSchema,
} from "./_schema.ts";

Deno.test("TransportSchema", async (t) => {
  await t.step("accepts websocket", () => {
    expect(TransportSchema.safeParse("websocket").success).toBe(true);
  });

  await t.step("accepts twilio", () => {
    expect(TransportSchema.safeParse("twilio").success).toBe(true);
  });

  await t.step("rejects invalid transport", () => {
    expect(TransportSchema.safeParse("grpc").success).toBe(false);
  });
});

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
      prompt: "Speak slowly",
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
      parameters: {},
    });
    expect(result.success).toBe(false);
  });
});

Deno.test("DeployBodySchema", async (t) => {
  await t.step("accepts valid deploy body", () => {
    const result = DeployBodySchema.safeParse({
      env: { ASSEMBLYAI_API_KEY: "test" },
      worker: "code",
      client: "code",
      config: {
        instructions: "Help",
        greeting: "Hi",
        voice: "luna",
      },
    });
    expect(result.success).toBe(true);
  });

  await t.step("rejects empty worker", () => {
    const result = DeployBodySchema.safeParse({
      env: {},
      worker: "",
      client: "code",
      config: {
        instructions: "Help",
        greeting: "Hi",
        voice: "luna",
      },
    });
    expect(result.success).toBe(false);
  });

  await t.step("accepts transport as string or array", () => {
    const asString = DeployBodySchema.safeParse({
      env: {},
      worker: "code",
      client: "code",
      transport: "twilio",
      config: { instructions: "x", greeting: "x", voice: "x" },
    });
    const asArray = DeployBodySchema.safeParse({
      env: {},
      worker: "code",
      client: "code",
      transport: ["websocket", "twilio"],
      config: { instructions: "x", greeting: "x", voice: "x" },
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
