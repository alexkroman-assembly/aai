// Copyright 2025 the AAI authors. MIT license.
import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertStringIncludes,
} from "@std/assert";
import { FakeTime } from "@std/testing/time";
import {
  createVoiceSession,
  parseServerMessage,
  type VoiceSession,
} from "./session.ts";
import { PING_INTERVAL_MS, type SessionOptions } from "./types.ts";
import { flush, installMockWebSocket } from "./_test_utils.ts";

function withSessionEnv(
  fn: (mock: ReturnType<typeof installMockWebSocket>) => void | Promise<void>,
) {
  return async () => {
    using mock = installMockWebSocket();
    await fn(mock);
  };
}

Deno.test("parseServerMessage", async (t) => {
  const valid: [string, Record<string, unknown>][] = [
    ["ready", {
      type: "ready",
      protocol_version: 1,
      audio_format: "pcm16",
      sample_rate: 16000,
      tts_sample_rate: 24000,
    }],
    ["partial_transcript", { type: "partial_transcript", text: "hello" }],
    ["final_transcript", { type: "final_transcript", text: "done" }],
    ["turn", { type: "turn", text: "What's the weather?" }],
    ["chat", { type: "chat", text: "It's sunny!" }],
    ["tts_done", { type: "tts_done" }],
    ["cancelled", { type: "cancelled" }],
    ["reset", { type: "reset" }],
    ["pong", { type: "pong" }],
    ["error", { type: "error", message: "Something failed" }],
    ["unknown type passes through", { type: "custom_extension", data: 1 }],
  ];

  for (const [label, payload] of valid) {
    await t.step(`parses ${label}`, () => {
      const msg = parseServerMessage(JSON.stringify(payload));
      assert(msg !== null);
      assertStrictEquals(msg!.type, payload.type);
    });
  }

  const rejected: [string, string][] = [
    ["invalid JSON", "not json at all"],
    ["missing type", JSON.stringify({ text: "no type" })],
    ["non-string type", JSON.stringify({ type: 123 })],
    ["null value", "null"],
    ["array", JSON.stringify([1, 2, 3])],
    ["primitive", JSON.stringify("just a string")],
  ];

  for (const [label, input] of rejected) {
    await t.step(`rejects ${label}`, () => {
      assertStrictEquals(parseServerMessage(input), null);
    });
  }
});

Deno.test("VoiceSession", async (t) => {
  const defaultOptions: SessionOptions = {
    platformUrl: "http://localhost:3000",
  };

  async function connectSession(
    mock: ReturnType<typeof installMockWebSocket>,
    opts: SessionOptions = defaultOptions,
  ): Promise<{ session: VoiceSession; ws: NonNullable<typeof mock.lastWs> }> {
    const session = createVoiceSession(opts);
    session.connect();
    await flush();
    return { session, ws: mock.lastWs! };
  }

  await t.step("connect()", async (t) => {
    await t.step(
      "creates a WebSocket and transitions to ready on open",
      withSessionEnv(async (mock) => {
        const { session } = await connectSession(mock);
        assert(mock.lastWs !== null);
        assertStrictEquals(session.state.value, "ready");
        session.disconnect();
      }),
    );

    await t.step(
      "constructs correct WebSocket URL from platformUrl",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock, {
          platformUrl: "https://example.com/api",
        });
        const url = ws.url.toString();
        assertStringIncludes(url, "wss://");
        assertStringIncludes(url, "websocket");
        session.disconnect();
      }),
    );

    await t.step(
      "uses ws:// for http:// platformUrl",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);
        assertStringIncludes(ws.url.toString(), "ws://");
        session.disconnect();
      }),
    );

    await t.step(
      "preserves full path in WebSocket URL",
      withSessionEnv(async (mock) => {
        // Regression: new URL(".", href) without trailing slash resolves to
        // parent path, e.g. /ns/slug → /ns/, losing the slug segment.
        const { session, ws } = await connectSession(mock, {
          platformUrl: "https://aai-agent.fly.dev/alex/ai-takes",
        });
        assertStrictEquals(
          ws.url.toString(),
          "wss://aai-agent.fly.dev/alex/ai-takes/websocket",
        );
        session.disconnect();
      }),
    );
  });

  await t.step("protocol negotiation", async (t) => {
    await t.step(
      "errors on incompatible protocol version",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);
        ws.simulateMessage(JSON.stringify({
          type: "ready",
          protocol_version: 99,
          audio_format: "pcm16",
          sample_rate: 16000,
          tts_sample_rate: 24000,
        }));
        assertStrictEquals(session.state.value, "error");
        assertStrictEquals(session.error.value?.code, "protocol");
        assertStringIncludes(session.error.value?.message ?? "", "v99");
        session.disconnect();
      }),
    );

    await t.step(
      "errors on unsupported audio format",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);
        ws.simulateMessage(JSON.stringify({
          type: "ready",
          protocol_version: 1,
          audio_format: "opus",
          sample_rate: 16000,
          tts_sample_rate: 24000,
        }));
        assertStrictEquals(session.state.value, "error");
        assertStrictEquals(session.error.value?.code, "protocol");
        assertStringIncludes(session.error.value?.message ?? "", "opus");
        session.disconnect();
      }),
    );

    await t.step(
      "accepts ready without protocol_version (backwards compat)",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);
        ws.simulateMessage(JSON.stringify({
          type: "ready",
          sample_rate: 16000,
          tts_sample_rate: 24000,
        }));
        // Should not error — old servers don't send protocol_version
        assert(session.state.value !== "error");
        session.disconnect();
      }),
    );
  });

  await t.step("handleServerMessage", async (t) => {
    await t.step(
      "handles PARTIAL_TRANSCRIPT message",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);

        ws.simulateMessage(
          JSON.stringify({ type: "partial_transcript", text: "hello" }),
        );
        assertStrictEquals(session.transcript.value, "hello");
        session.disconnect();
      }),
    );

    await t.step(
      "handles FINAL_TRANSCRIPT message",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);

        ws.simulateMessage(
          JSON.stringify({ type: "final_transcript", text: "hello world" }),
        );
        assertStrictEquals(session.transcript.value, "hello world");
        session.disconnect();
      }),
    );

    await t.step(
      "handles TURN message and replaces transcript",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);

        ws.simulateMessage(
          JSON.stringify({ type: "partial_transcript", text: "helo" }),
        );
        ws.simulateMessage(
          JSON.stringify({ type: "turn", text: "Hello" }),
        );

        assertStrictEquals(session.messages.value.length, 1);
        assertStrictEquals(session.messages.value[0]!.role, "user");
        assertStrictEquals(session.messages.value[0]!.text, "Hello");
        assertStrictEquals(session.transcript.value, "");
        assertStrictEquals(session.state.value, "thinking");
        session.disconnect();
      }),
    );

    await t.step(
      "handles CHAT message",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);

        ws.simulateMessage(
          JSON.stringify({ type: "chat", text: "response" }),
        );

        assertStrictEquals(session.messages.value.length, 1);
        assertStrictEquals(session.messages.value[0]!.role, "assistant");
        assertStrictEquals(session.state.value, "speaking");
        session.disconnect();
      }),
    );

    await t.step(
      "handles TTS_DONE message",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);

        ws.simulateMessage(JSON.stringify({ type: "chat", text: "Hi" }));
        ws.simulateMessage(JSON.stringify({ type: "tts_done" }));

        assertStrictEquals(session.state.value, "listening");
        session.disconnect();
      }),
    );

    await t.step(
      "handles CANCELLED message",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);

        ws.simulateMessage(JSON.stringify({ type: "cancelled" }));
        assertStrictEquals(session.state.value, "listening");
        session.disconnect();
      }),
    );

    await t.step(
      "handles RESET message",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);

        ws.simulateMessage(JSON.stringify({ type: "chat", text: "Hi" }));
        assertStrictEquals(session.messages.value.length, 1);

        ws.simulateMessage(JSON.stringify({ type: "reset" }));
        assertEquals(session.messages.value, []);
        assertStrictEquals(session.transcript.value, "");
        assertStrictEquals(session.error.value, null);
        session.disconnect();
      }),
    );

    await t.step(
      "handles ERROR message",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);

        ws.simulateMessage(
          JSON.stringify({ type: "error", message: "Something went wrong" }),
        );

        assert(session.error.value !== null);
        assertStrictEquals(session.error.value!.code, "protocol");
        assertStringIncludes(
          session.error.value!.message,
          "Something went wrong",
        );
        session.disconnect();
      }),
    );

    await t.step(
      "handles ERROR message with details",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);

        ws.simulateMessage(
          JSON.stringify({
            type: "error",
            message: "Failed",
            details: ["detail1", "detail2"],
          }),
        );

        assert(session.error.value !== null);
        assertStringIncludes(session.error.value!.message, "detail1");
        session.disconnect();
      }),
    );
  });

  await t.step("cancel()", async (t) => {
    await t.step(
      "sends cancel message over WebSocket",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);
        session.cancel();

        const sentStrings = ws.sent.filter(
          (d): d is string => typeof d === "string",
        );
        const cancelMsg = sentStrings.find((s) =>
          JSON.parse(s).type === "cancel"
        );
        assert(cancelMsg !== undefined);
        session.disconnect();
      }),
    );

    await t.step(
      "transitions to listening state",
      withSessionEnv(async (mock) => {
        const { session } = await connectSession(mock);

        session.cancel();
        assertStrictEquals(session.state.value, "listening");
        session.disconnect();
      }),
    );
  });

  await t.step("reset()", async (t) => {
    await t.step(
      "sends reset message when WS is open",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);
        session.reset();

        const sentStrings = ws.sent.filter(
          (d): d is string => typeof d === "string",
        );
        const resetMsg = sentStrings.find((s) =>
          JSON.parse(s).type === "reset"
        );
        assert(resetMsg !== undefined);
        session.disconnect();
      }),
    );

    await t.step(
      "clears state and reconnects when WS is closed",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);

        ws.simulateMessage(JSON.stringify({ type: "chat", text: "Hi" }));
        assertStrictEquals(session.messages.value.length, 1);

        session.disconnect();
        session.reset();
        await flush();

        assertEquals(session.messages.value, []);
        session.disconnect();
      }),
    );
  });

  await t.step("disconnect()", async (t) => {
    await t.step(
      "sets disconnected signal with intentional: true",
      withSessionEnv(async (mock) => {
        const { session } = await connectSession(mock);

        session.disconnect();

        assert(session.disconnected.value !== null);
        assertStrictEquals(session.disconnected.value!.intentional, true);
      }),
    );

    await t.step(
      "closes WebSocket",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);
        session.disconnect();
        assertStrictEquals(ws.readyState, WebSocket.CLOSED);
      }),
    );

    await t.step(
      "is safe to call when not connected",
      withSessionEnv(() => {
        const session = createVoiceSession(defaultOptions);
        session.disconnect(); // should not throw
      }),
    );
  });

  await t.step("reconnection on close", async (t) => {
    await t.step(
      "sets disconnected signal on unexpected close",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);

        ws.close(1006);
        await flush();

        assert(session.disconnected.value !== null);
        assertStrictEquals(session.disconnected.value!.intentional, false);
        session.disconnect();
      }),
    );
  });

  await t.step("ping/pong", async (t) => {
    await t.step(
      "sends ping messages at interval",
      withSessionEnv(async (mock) => {
        using time = new FakeTime();
        const session = createVoiceSession(defaultOptions);
        session.connect();

        await time.tickAsync(0);
        await time.tickAsync(PING_INTERVAL_MS + 10);

        const sentStrings = mock.lastWs!.sent.filter(
          (d): d is string => typeof d === "string",
        );
        const pings = sentStrings.filter((s) => {
          try {
            return JSON.parse(s).type === "ping";
          } catch {
            return false;
          }
        });
        assert(pings.length >= 1);

        session.disconnect();
      }),
    );
  });

  await t.step("signal deduplication", async (t) => {
    await t.step(
      "does not re-notify when state hasn't changed",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);

        ws.simulateMessage(JSON.stringify({ type: "cancelled" }));
        assertStrictEquals(session.state.value, "listening");

        ws.simulateMessage(JSON.stringify({ type: "cancelled" }));
        assertStrictEquals(session.state.value, "listening");
        session.disconnect();
      }),
    );
  });
});
