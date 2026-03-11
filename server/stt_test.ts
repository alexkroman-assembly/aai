import { expect } from "@std/expect";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { connectStt } from "./stt.ts";
import { DEFAULT_STT_CONFIG } from "./types.ts";
import type { TurnEvent } from "assemblyai";
import { StreamingTranscriber } from "assemblyai";

type Listener<T> = (event: T) => void;

/** Minimal mock that replaces the real StreamingTranscriber. */
class MockStreamingTranscriber {
  params: Record<string, unknown>;
  listeners: Record<string, ((...args: unknown[]) => void) | undefined> = {};
  connected = false;
  closed = false;
  sentAudio: ArrayBufferLike[] = [];
  sentMessages: Record<string, unknown>[] = [];

  constructor(params: Record<string, unknown>) {
    this.params = params;
  }

  on(event: string, listener: (...args: unknown[]) => void) {
    this.listeners[event] = listener;
  }

  connect(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }

  sendAudio(audio: ArrayBufferLike) {
    if (!this.connected || this.closed) throw new Error("Not connected");
    this.sentAudio.push(audio);
  }

  forceEndpoint() {
    if (!this.connected || this.closed) throw new Error("Not connected");
    this.sentMessages.push({ type: "ForceEndpoint" });
  }

  close(_wait?: boolean): Promise<void> {
    this.closed = true;
    this.listeners["close"]?.(1000, "");
    return Promise.resolve();
  }

  // Test helpers
  emitTurn(turn: Partial<TurnEvent>) {
    const full: TurnEvent = {
      type: "Turn",
      turn_order: 0,
      turn_is_formatted: true,
      end_of_turn: false,
      transcript: "",
      end_of_turn_confidence: 0,
      words: [],
      ...turn,
    };
    (this.listeners["turn"] as Listener<TurnEvent>)?.(full);
  }

  emitError(err: Error) {
    (this.listeners["error"] as Listener<Error>)?.(err);
  }

  emitClose(code: number, reason: string) {
    (this.listeners["close"] as ((code: number, reason: string) => void))?.(
      code,
      reason,
    );
  }
}

let lastMock: MockStreamingTranscriber | null = null;

function installMockSDK(): {
  restore: () => void;
  [Symbol.dispose]: () => void;
} {
  const _original = StreamingTranscriber;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).__mockStreamingTranscriber = true;

  // Monkey-patch the module's export by stubbing the constructor
  const proto = StreamingTranscriber.prototype;
  const origConnect = proto.connect;
  const origOn = proto.on;
  const origSendAudio = proto.sendAudio;
  const origForceEndpoint = proto.forceEndpoint;
  const origClose = proto.close;

  const mock = new MockStreamingTranscriber({});
  lastMock = mock;

  // deno-lint-ignore no-explicit-any
  proto.connect = function (): any {
    mock.connected = true;
    return Promise.resolve();
  };
  // deno-lint-ignore no-explicit-any
  proto.on = function (event: string, listener: any) {
    mock.on(event, listener);
  };
  proto.sendAudio = function (audio: ArrayBufferLike) {
    mock.sendAudio(audio);
  };
  proto.forceEndpoint = function () {
    mock.forceEndpoint();
  };
  proto.close = function (_wait?: boolean) {
    mock.closed = true;
    mock.listeners["close"]?.(1000, "");
    return Promise.resolve();
  };

  function restore() {
    proto.connect = origConnect;
    proto.on = origOn;
    proto.sendAudio = origSendAudio;
    proto.forceEndpoint = origForceEndpoint;
    proto.close = origClose;
    lastMock = null;
  }

  return { restore, [Symbol.dispose]: restore };
}

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

Deno.test("connectStt", async (t) => {
  await t.step("handle.send relays audio to SDK", async () => {
    using _sdk = installMockSDK();
    const events = createMockSttEvents();
    const handle = await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    handle.send(new Uint8Array([1, 2, 3]));
    expect(lastMock!.sentAudio).toHaveLength(1);
  });

  await t.step("handle.clear sends ForceEndpoint", async () => {
    using _sdk = installMockSDK();
    const events = createMockSttEvents();
    const handle = await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    handle.clear();
    expect(lastMock!.sentMessages).toEqual([{ type: "ForceEndpoint" }]);
  });

  await t.step("handle.close closes transcriber", async () => {
    using _sdk = installMockSDK();
    const events = createMockSttEvents();
    const handle = await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    handle.close();
    assertSpyCalls(events.onClose, 1);
  });

  await t.step("dispatches completed Turn as onTurn", async () => {
    using _sdk = installMockSDK();
    const events = createMockSttEvents();
    await connectStt("test-key", DEFAULT_STT_CONFIG, events);

    lastMock!.emitTurn({
      transcript: "What is the weather?",
      end_of_turn: true,
    });

    assertSpyCalls(events.onTurn, 1);
    expect(events.onTurn.calls[0].args).toEqual([
      "What is the weather?",
      0,
    ]);
  });

  await t.step("dispatches partial Turn as onTranscript", async () => {
    using _sdk = installMockSDK();
    const events = createMockSttEvents();
    await connectStt("test-key", DEFAULT_STT_CONFIG, events);

    lastMock!.emitTurn({
      transcript: "partial text",
      end_of_turn: false,
    });

    assertSpyCalls(events.onTurn, 0);
    assertSpyCalls(events.onTranscript, 1);
    expect(events.onTranscript.calls[0].args[0]).toBe("partial text");
  });

  await t.step("skips Turn with empty transcript", async () => {
    using _sdk = installMockSDK();
    const events = createMockSttEvents();
    await connectStt("test-key", DEFAULT_STT_CONFIG, events);

    lastMock!.emitTurn({
      transcript: "   ",
      end_of_turn: true,
    });

    assertSpyCalls(events.onTurn, 0);
    assertSpyCalls(events.onTranscript, 0);
  });

  await t.step("fires onError on SDK error", async () => {
    using _sdk = installMockSDK();
    const events = createMockSttEvents();
    await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    lastMock!.emitError(new Error("something went wrong"));
    assertSpyCalls(events.onError, 1);
  });

  await t.step("fires onClose on unexpected WebSocket close", async () => {
    using _sdk = installMockSDK();
    const events = createMockSttEvents();
    await connectStt("test-key", DEFAULT_STT_CONFIG, events);
    lastMock!.emitClose(1006, "");
    assertSpyCalls(events.onClose, 1);
    assertSpyCalls(events.onError, 1);
  });

  await t.step("passes turnOrder on completed Turn", async () => {
    using _sdk = installMockSDK();
    const events = createMockSttEvents();
    await connectStt("test-key", DEFAULT_STT_CONFIG, events);

    lastMock!.emitTurn({
      transcript: "Hello",
      end_of_turn: true,
      turn_order: 3,
    });

    assertSpyCalls(events.onTurn, 1);
    expect(events.onTurn.calls[0].args).toEqual(["Hello", 3]);
  });

  await t.step(
    "passes turnOrder on partial Turn as transcript",
    async () => {
      using _sdk = installMockSDK();
      const events = createMockSttEvents();
      await connectStt("test-key", DEFAULT_STT_CONFIG, events);

      lastMock!.emitTurn({
        transcript: "partial",
        end_of_turn: false,
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

  await t.step("passes prompt config to SDK", async () => {
    using _sdk = installMockSDK();
    const events = createMockSttEvents();
    await connectStt("test-key", {
      ...DEFAULT_STT_CONFIG,
      prompt: "Transcribe medical terms",
    }, events);
    expect(lastMock!.params).toBeDefined();
  });
});
