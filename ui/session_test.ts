import { expect } from "@std/expect";
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
    ["ready", { type: "ready", sample_rate: 16000, tts_sample_rate: 24000 }],
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
      expect(msg).not.toBeNull();
      expect(msg!.type).toBe(payload.type);
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
      expect(parseServerMessage(input)).toBeNull();
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
        expect(mock.lastWs).not.toBeNull();
        expect(session.state.value).toBe("ready");
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
        expect(url).toContain("wss://");
        expect(url).toContain("websocket");
        session.disconnect();
      }),
    );

    await t.step(
      "uses ws:// for http:// platformUrl",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);
        expect(ws.url.toString()).toContain("ws://");
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
        expect(session.transcript.value).toBe("hello");
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
        expect(session.transcript.value).toBe("hello world");
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

        expect(session.messages.value).toHaveLength(1);
        expect(session.messages.value[0].role).toBe("user");
        expect(session.messages.value[0].text).toBe("Hello");
        expect(session.transcript.value).toBe("");
        expect(session.state.value).toBe("thinking");
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

        expect(session.messages.value).toHaveLength(1);
        expect(session.messages.value[0].role).toBe("assistant");
        expect(session.state.value).toBe("speaking");
        session.disconnect();
      }),
    );

    await t.step(
      "handles TTS_DONE message",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);

        ws.simulateMessage(JSON.stringify({ type: "chat", text: "Hi" }));
        ws.simulateMessage(JSON.stringify({ type: "tts_done" }));

        expect(session.state.value).toBe("listening");
        session.disconnect();
      }),
    );

    await t.step(
      "handles CANCELLED message",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);

        ws.simulateMessage(JSON.stringify({ type: "cancelled" }));
        expect(session.state.value).toBe("listening");
        session.disconnect();
      }),
    );

    await t.step(
      "handles RESET message",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);

        ws.simulateMessage(JSON.stringify({ type: "chat", text: "Hi" }));
        expect(session.messages.value).toHaveLength(1);

        ws.simulateMessage(JSON.stringify({ type: "reset" }));
        expect(session.messages.value).toEqual([]);
        expect(session.transcript.value).toBe("");
        expect(session.error.value).toBeNull();
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

        expect(session.error.value).not.toBeNull();
        expect(session.error.value!.code).toBe("protocol");
        expect(session.error.value!.message).toContain("Something went wrong");
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

        expect(session.error.value).not.toBeNull();
        expect(session.error.value!.message).toContain("detail1");
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
        expect(cancelMsg).toBeDefined();
        session.disconnect();
      }),
    );

    await t.step(
      "transitions to listening state",
      withSessionEnv(async (mock) => {
        const { session } = await connectSession(mock);

        session.cancel();
        expect(session.state.value).toBe("listening");
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
        expect(resetMsg).toBeDefined();
        session.disconnect();
      }),
    );

    await t.step(
      "clears state and reconnects when WS is closed",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);

        ws.simulateMessage(JSON.stringify({ type: "chat", text: "Hi" }));
        expect(session.messages.value).toHaveLength(1);

        session.disconnect();
        session.reset();
        await flush();

        expect(session.messages.value).toEqual([]);
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

        expect(session.disconnected.value).not.toBeNull();
        expect(session.disconnected.value!.intentional).toBe(true);
      }),
    );

    await t.step(
      "closes WebSocket",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);
        session.disconnect();
        expect(ws.readyState).toBe(WebSocket.CLOSED);
      }),
    );

    await t.step(
      "is safe to call when not connected",
      withSessionEnv(() => {
        const session = createVoiceSession(defaultOptions);
        expect(() => session.disconnect()).not.toThrow();
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

        expect(session.disconnected.value).not.toBeNull();
        expect(session.disconnected.value!.intentional).toBe(false);
        session.disconnect();
      }),
    );
  });

  await t.step("ping/pong", async (t) => {
    await t.step(
      "sends ping messages at interval",
      withSessionEnv(async (mock) => {
        const time = new FakeTime();
        try {
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
          expect(pings.length).toBeGreaterThanOrEqual(1);

          session.disconnect();
        } finally {
          time.restore();
        }
      }),
    );
  });

  await t.step("signal deduplication", async (t) => {
    await t.step(
      "does not re-notify when state hasn't changed",
      withSessionEnv(async (mock) => {
        const { session, ws } = await connectSession(mock);

        ws.simulateMessage(JSON.stringify({ type: "cancelled" }));
        expect(session.state.value).toBe("listening");

        ws.simulateMessage(JSON.stringify({ type: "cancelled" }));
        expect(session.state.value).toBe("listening");
        session.disconnect();
      }),
    );
  });
});
