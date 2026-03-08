import { expect } from "@std/expect";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { connectStt } from "./stt.ts";
import { DEFAULT_STT_CONFIG } from "./types.ts";
import { installMockWebSocket, type MockWebSocket } from "./_mock_ws.ts";

function createMockSttEvents() {
  return {
    onTranscript: spy(
      (_text: string, _isFinal: boolean, _turnOrder?: number) => {},
    ),
    onTurn: spy((_text: string, _turnOrder?: number) => {}),
    onTermination: spy(
      (_audioDuration: number, _sessionDuration: number) => {},
    ),
    onError: spy((_err: Error) => {}),
    onClose: spy(() => {}),
  };
}

function sendMsg(ws: MockWebSocket, data: Record<string, unknown>) {
  ws.dispatchEvent(
    new MessageEvent("message", { data: JSON.stringify(data) }),
  );
}

Deno.test("connectStt", async (t) => {
  await t.step("handle.send relays audio to WebSocket", async () => {
    using mockWs = installMockWebSocket();
    const events = createMockSttEvents();
    const handle = await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    handle.send(new Uint8Array([1, 2, 3]));
    expect(mockWs.created[0].sent).toHaveLength(1);
  });

  await t.step("handle.clear sends ForceEndpoint", async () => {
    using mockWs = installMockWebSocket();
    const events = createMockSttEvents();
    const handle = await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    handle.clear();
    const sent = mockWs.created[0].sent
      .filter((d): d is string => typeof d === "string");
    expect(sent.some((s) => JSON.parse(s).type === "ForceEndpoint")).toBe(
      true,
    );
  });

  await t.step("handle.close closes WebSocket", async () => {
    using _mockWs = installMockWebSocket();
    const events = createMockSttEvents();
    const handle = await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    handle.close();
    assertSpyCalls(events.onClose, 1);
  });

  await t.step("dispatches Transcript messages", async () => {
    using mockWs = installMockWebSocket();
    const events = createMockSttEvents();
    await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    const ws = mockWs.created[0];

    sendMsg(ws, { type: "Transcript", transcript: "hello", is_final: false });
    sendMsg(ws, { type: "Transcript", transcript: "world", is_final: true });

    assertSpyCalls(events.onTranscript, 2);
    expect(events.onTranscript.calls[0].args).toEqual([
      "hello",
      false,
      undefined,
    ]);
    expect(events.onTranscript.calls[1].args).toEqual([
      "world",
      true,
      undefined,
    ]);
  });

  await t.step("dispatches formatted Turn as onTurn", async () => {
    using mockWs = installMockWebSocket();
    const events = createMockSttEvents();
    await connectStt("test-key", DEFAULT_STT_CONFIG, events);

    sendMsg(mockWs.created[0], {
      type: "Turn",
      transcript: "What is the weather?",
      turn_is_formatted: true,
    });

    assertSpyCalls(events.onTurn, 1);
    expect(events.onTurn.calls[0].args).toEqual([
      "What is the weather?",
      undefined,
    ]);
  });

  await t.step("dispatches unformatted Turn as onTranscript", async () => {
    using mockWs = installMockWebSocket();
    const events = createMockSttEvents();
    await connectStt("test-key", DEFAULT_STT_CONFIG, events);

    sendMsg(mockWs.created[0], {
      type: "Turn",
      transcript: "unformatted text",
      turn_is_formatted: false,
    });

    assertSpyCalls(events.onTurn, 0);
    assertSpyCalls(events.onTranscript, 1);
    expect(events.onTranscript.calls[0].args[0]).toBe("unformatted text");
  });

  await t.step("skips Turn with empty transcript", async () => {
    using mockWs = installMockWebSocket();
    const events = createMockSttEvents();
    await connectStt("test-key", DEFAULT_STT_CONFIG, events);

    sendMsg(mockWs.created[0], {
      type: "Turn",
      transcript: "   ",
      turn_is_formatted: true,
    });

    assertSpyCalls(events.onTurn, 0);
    assertSpyCalls(events.onTranscript, 0);
  });

  await t.step("skips invalid and non-string messages", async () => {
    using mockWs = installMockWebSocket();
    const events = createMockSttEvents();
    await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    const ws = mockWs.created[0];

    ws.dispatchEvent(new MessageEvent("message", { data: "not json" }));
    ws.dispatchEvent(
      new MessageEvent("message", { data: new ArrayBuffer(8) }),
    );
    sendMsg(ws, { type: "UnknownType", data: 123 });

    assertSpyCalls(events.onTranscript, 0);
    assertSpyCalls(events.onTurn, 0);
  });

  await t.step("fires onError on WebSocket error", async () => {
    using mockWs = installMockWebSocket();
    const events = createMockSttEvents();
    await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    mockWs.created[0].dispatchEvent(new Event("error"));
    assertSpyCalls(events.onError, 1);
  });

  await t.step("fires onClose on unexpected WebSocket close", async () => {
    using mockWs = installMockWebSocket();
    const events = createMockSttEvents();
    await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    mockWs.created[0].dispatchEvent(new CloseEvent("close", { code: 1006 }));
    assertSpyCalls(events.onClose, 1);
    assertSpyCalls(events.onError, 1);
  });

  await t.step("dispatches Termination event with durations", async () => {
    using mockWs = installMockWebSocket();
    const events = createMockSttEvents();
    await connectStt("test-key", DEFAULT_STT_CONFIG, events);

    sendMsg(mockWs.created[0], {
      type: "Termination",
      audio_duration_seconds: 12.5,
      session_duration_seconds: 60.0,
    });

    assertSpyCalls(events.onTermination, 1);
    expect(events.onTermination.calls[0].args).toEqual([12.5, 60.0]);
  });

  await t.step("passes turnOrder on formatted Turn", async () => {
    using mockWs = installMockWebSocket();
    const events = createMockSttEvents();
    await connectStt("test-key", DEFAULT_STT_CONFIG, events);

    sendMsg(mockWs.created[0], {
      type: "Turn",
      transcript: "Hello",
      turn_is_formatted: true,
      turn_order: 3,
    });

    assertSpyCalls(events.onTurn, 1);
    expect(events.onTurn.calls[0].args).toEqual(["Hello", 3]);
  });

  await t.step(
    "passes turnOrder on unformatted Turn as transcript",
    async () => {
      using mockWs = installMockWebSocket();
      const events = createMockSttEvents();
      await connectStt("test-key", DEFAULT_STT_CONFIG, events);

      sendMsg(mockWs.created[0], {
        type: "Turn",
        transcript: "partial",
        turn_is_formatted: false,
        turn_order: 2,
      });

      assertSpyCalls(events.onTranscript, 1);
      expect(events.onTranscript.calls[0].args).toEqual([
        "partial",
        false,
        2,
      ]);
    },
  );

  await t.step("includes prompt in URL when configured", async () => {
    using mockWs = installMockWebSocket();
    const events = createMockSttEvents();
    await connectStt("test-key", {
      ...DEFAULT_STT_CONFIG,
      prompt: "Transcribe medical terms",
    }, events);
    expect(mockWs.created[0].url).toContain("prompt=");
  });
});
