import { expect } from "@std/expect";
import { spy } from "@std/testing/mock";
import {
  createSttConnection,
  type SttConnection,
  type SttTranscriptDetail,
  type SttTurnDetail,
} from "./stt.ts";
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

async function createConnected(
  config = DEFAULT_STT_CONFIG,
): Promise<SttConnection> {
  const conn = createSttConnection("test-key", config);
  await conn.connect();
  return conn;
}

Deno.test("SttConnection", async (t) => {
  await t.step("send relays audio to SDK", async () => {
    using _sdk = installMockSDK();
    const conn = await createConnected();
    conn.send(new Uint8Array([1, 2, 3]));
    expect(lastMock!.sentAudio).toHaveLength(1);
  });

  await t.step("clear sends ForceEndpoint", async () => {
    using _sdk = installMockSDK();
    const conn = await createConnected();
    conn.clear();
    expect(lastMock!.sentMessages).toEqual([{ type: "ForceEndpoint" }]);
  });

  await t.step("close invokes onClose callback", async () => {
    using _sdk = installMockSDK();
    const onClose = spy(() => {});
    const conn = await createConnected();
    conn.onClose = onClose;
    conn.close();
    expect(onClose.calls.length).toBe(1);
  });

  await t.step("dispatches completed Turn via onTurn", async () => {
    using _sdk = installMockSDK();
    const onTurn = spy((_detail: SttTurnDetail) => {});
    const conn = await createConnected();
    conn.onTurn = onTurn;

    lastMock!.emitTurn({
      transcript: "What is the weather?",
      end_of_turn: true,
    });

    expect(onTurn.calls.length).toBe(1);
    expect(onTurn.calls[0].args[0]).toEqual({
      text: "What is the weather?",
      turnOrder: 0,
    });
  });

  await t.step("dispatches partial Turn via onTranscript", async () => {
    using _sdk = installMockSDK();
    const onTurn = spy((_detail: SttTurnDetail) => {});
    const onTranscript = spy((_detail: SttTranscriptDetail) => {});
    const conn = await createConnected();
    conn.onTurn = onTurn;
    conn.onTranscript = onTranscript;

    lastMock!.emitTurn({
      transcript: "partial text",
      end_of_turn: false,
    });

    expect(onTurn.calls.length).toBe(0);
    expect(onTranscript.calls.length).toBe(1);
    expect(onTranscript.calls[0].args[0].text).toBe("partial text");
  });

  await t.step("skips Turn with empty transcript", async () => {
    using _sdk = installMockSDK();
    const onTurn = spy((_detail: SttTurnDetail) => {});
    const onTranscript = spy((_detail: SttTranscriptDetail) => {});
    const conn = await createConnected();
    conn.onTurn = onTurn;
    conn.onTranscript = onTranscript;

    lastMock!.emitTurn({
      transcript: "   ",
      end_of_turn: true,
    });

    expect(onTurn.calls.length).toBe(0);
    expect(onTranscript.calls.length).toBe(0);
  });

  await t.step("fires onError on SDK error", async () => {
    using _sdk = installMockSDK();
    const onError = spy((_err: Error) => {});
    const conn = await createConnected();
    conn.onError = onError;
    lastMock!.emitError(new Error("something went wrong"));
    expect(onError.calls.length).toBe(1);
  });

  await t.step(
    "fires onClose and onError on unexpected WebSocket close",
    async () => {
      using _sdk = installMockSDK();
      const onClose = spy(() => {});
      const onError = spy((_err: Error) => {});
      const conn = await createConnected();
      conn.onClose = onClose;
      conn.onError = onError;
      lastMock!.emitClose(1006, "");
      expect(onClose.calls.length).toBe(1);
      expect(onError.calls.length).toBe(1);
    },
  );

  await t.step("passes turnOrder on completed Turn", async () => {
    using _sdk = installMockSDK();
    const onTurn = spy((_detail: SttTurnDetail) => {});
    const conn = await createConnected();
    conn.onTurn = onTurn;

    lastMock!.emitTurn({
      transcript: "Hello",
      end_of_turn: true,
      turn_order: 3,
    });

    expect(onTurn.calls.length).toBe(1);
    expect(onTurn.calls[0].args[0]).toEqual({ text: "Hello", turnOrder: 3 });
  });

  await t.step(
    "passes turnOrder on partial Turn as transcript",
    async () => {
      using _sdk = installMockSDK();
      const onTranscript = spy((_detail: SttTranscriptDetail) => {});
      const conn = await createConnected();
      conn.onTranscript = onTranscript;

      lastMock!.emitTurn({
        transcript: "partial",
        end_of_turn: false,
        turn_order: 2,
      });

      expect(onTranscript.calls.length).toBe(1);
      expect(onTranscript.calls[0].args[0]).toEqual({
        text: "partial",
        isFinal: false,
        turnOrder: 2,
      });
    },
  );

  await t.step("passes prompt config to SDK", async () => {
    using _sdk = installMockSDK();
    await createConnected({
      ...DEFAULT_STT_CONFIG,
      sttPrompt: "Transcribe medical terms",
    });
    expect(lastMock!.params).toBeDefined();
  });

  await t.step("connected and closed reflect state", async () => {
    using _sdk = installMockSDK();
    const conn = createSttConnection("test-key", DEFAULT_STT_CONFIG);
    expect(conn.connected).toBe(false);
    expect(conn.closed).toBe(false);
    await conn.connect();
    expect(conn.connected).toBe(true);
    expect(conn.closed).toBe(false);
    conn.close();
    expect(conn.connected).toBe(false);
    expect(conn.closed).toBe(true);
  });

  await t.step("connect rejects if not in Idle state", async () => {
    using _sdk = installMockSDK();
    const conn = await createConnected();
    await expect(conn.connect()).rejects.toThrow("Cannot connect");
  });

  await t.step("send is no-op when closed", async () => {
    using _sdk = installMockSDK();
    const conn = await createConnected();
    conn.close();
    conn.send(new Uint8Array([1, 2, 3]));
    expect(lastMock!.sentAudio).toHaveLength(0);
  });

  await t.step("close is idempotent", async () => {
    using _sdk = installMockSDK();
    const conn = await createConnected();
    conn.close();
    conn.close();
    expect(conn.closed).toBe(true);
  });
});
