import { expect } from "@std/expect";
import {
  AUDIO_FORMAT,
  AudioFrameSpec,
  ClientMessageSchema,
  ClientStateMachine,
  DEFAULT_STT_SAMPLE_RATE,
  DEFAULT_TTS_SAMPLE_RATE,
  DevRegisteredSchema,
  DevRegisterSchema,
  PROTOCOL_VERSION,
  ProtocolValidator,
  ServerMessageSchema,
  ServerStateMachine,
} from "./_protocol.ts";

Deno.test("protocol constants", async (t) => {
  await t.step("default sample rates", () => {
    expect(DEFAULT_STT_SAMPLE_RATE).toBe(16_000);
    expect(DEFAULT_TTS_SAMPLE_RATE).toBe(24_000);
  });
  await t.step("protocol version", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
  await t.step("audio format", () => {
    expect(AUDIO_FORMAT).toBe("pcm16");
  });
});

Deno.test("DevRegisterSchema", async (t) => {
  await t.step("accepts valid message", () => {
    const result = DevRegisterSchema.safeParse({
      type: "dev_register",
      token: "test-api-key",
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

Deno.test("AudioFrameSpec", async (t) => {
  await t.step("format matches AUDIO_FORMAT", () => {
    expect(AudioFrameSpec.format).toBe(AUDIO_FORMAT);
  });

  await t.step("bytesPerSample is consistent", () => {
    expect(AudioFrameSpec.bytesPerSample).toBe(
      (AudioFrameSpec.bitsPerSample / 8) * AudioFrameSpec.channels,
    );
  });
});

Deno.test("ProtocolValidator - server", async (t) => {
  await t.step("allows valid happy-path sequence", () => {
    const v = new ProtocolValidator(ServerStateMachine);
    expect(v.state).toBe("connected");

    v.send("ready");
    expect(v.state).toBe("ready");

    v.send("partial_transcript");
    v.send("partial_transcript");
    v.send("final_transcript");
    v.send("turn");
    expect(v.state).toBe("turn");

    v.send("chat");
    expect(v.state).toBe("chat");

    v.send("audio");
    v.send("audio");
    v.send("tts_done");
    expect(v.state).toBe("tts_done");
  });

  await t.step("pong is allowed in any state and doesn't change state", () => {
    const v = new ProtocolValidator(ServerStateMachine);
    v.send("ready");
    expect(v.state).toBe("ready");
    v.send("pong");
    expect(v.state).toBe("ready");
  });

  await t.step("rejects invalid transition", () => {
    const v = new ProtocolValidator(ServerStateMachine);
    expect(() => v.send("chat")).toThrow("Protocol violation");
  });

  await t.step("rejects audio before chat", () => {
    const v = new ProtocolValidator(ServerStateMachine);
    v.send("ready");
    v.send("partial_transcript");
    v.send("final_transcript");
    v.send("turn");
    // audio is only allowed after chat
    expect(() => v.send("audio")).toThrow("Protocol violation");
  });

  await t.step("allows cancellation during audio", () => {
    const v = new ProtocolValidator(ServerStateMachine);
    v.send("ready");
    v.send("final_transcript");
    v.send("turn");
    v.send("chat");
    v.send("audio");
    v.send("cancelled");
    expect(v.state).toBe("cancelled");
  });

  await t.step("allows greeting (chat) after tts_done", () => {
    const v = new ProtocolValidator(ServerStateMachine);
    v.send("ready");
    v.send("final_transcript");
    v.send("turn");
    v.send("chat");
    v.send("tts_done");
    // greeting is a chat right after tts_done
    v.send("chat");
    expect(v.state).toBe("chat");
  });

  await t.step("reset allows", () => {
    const v = new ProtocolValidator(ServerStateMachine);
    v.send("ready");
    v.send("final_transcript");
    v.send("turn");
    v.send("chat");
    v.send("tts_done");
    v.send("partial_transcript");
    v.send("final_transcript");
    v.send("turn");
    v.send("chat");
    v.send("audio");
    v.send("tts_done");
  });
});

Deno.test("ProtocolValidator - client", async (t) => {
  await t.step("allows valid happy-path sequence", () => {
    const v = new ProtocolValidator(ClientStateMachine);
    expect(v.state).toBe("connected");

    v.send("history");
    v.send("audio_ready");
    expect(v.state).toBe("audio_ready");

    v.send("audio");
    v.send("audio");
    v.send("audio");
  });

  await t.step("ping is allowed in any state and doesn't change state", () => {
    const v = new ProtocolValidator(ClientStateMachine);
    v.send("ping");
    expect(v.state).toBe("connected");
  });

  await t.step("allows cancel during audio", () => {
    const v = new ProtocolValidator(ClientStateMachine);
    v.send("audio_ready");
    v.send("audio");
    v.send("cancel");
    expect(v.state).toBe("cancel");
    // can resume audio after cancel
    v.send("audio");
  });

  await t.step("allows reset", () => {
    const v = new ProtocolValidator(ClientStateMachine);
    v.send("audio_ready");
    v.send("audio");
    v.send("reset");
    expect(v.state).toBe("reset");
    // after reset, audio_ready is needed again
    v.send("audio_ready");
  });

  await t.step("rejects audio before audio_ready", () => {
    const v = new ProtocolValidator(ClientStateMachine);
    expect(() => v.send("audio")).toThrow("Protocol violation");
  });

  await t.step("reset() restores initial state", () => {
    const v = new ProtocolValidator(ClientStateMachine);
    v.send("audio_ready");
    v.send("audio");
    v.reset();
    expect(v.state).toBe("connected");
  });
});
